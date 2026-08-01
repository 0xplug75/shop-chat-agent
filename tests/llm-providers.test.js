import { describe, expect, it, vi } from "vitest";
import {
  calculateCostMicros,
  createLLMGateway,
  LLMGatewayError,
} from "../app/services/llm-gateway.server";
import { createAnthropicProvider } from "../app/services/llm/anthropic-provider.server";
import { createFakeProvider } from "../app/services/llm/fake-provider.server";
import { createOpenAICompatibleProvider } from "../app/services/llm/openai-compatible-provider.server";
import {
  assertProviderAdapter,
  STANDARD_PROVIDER_CAPABILITIES,
} from "../app/services/llm/provider-contract.server";
import {
  createProviderRegistry,
  resolvePrimaryProvider,
} from "../app/services/llm/provider-registry.server";
import {
  createTurnSideEffectState,
  SIDE_EFFECT_STATES,
} from "../app/services/commerce-mutation.server";

const baseContext = {
  system: "Use only verified catalog facts.",
  messages: [{ role: "user", content: "Find a board" }],
  tools: [
    {
      name: "search_catalog",
      description: "Search products",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  ],
  maxTokens: 200,
  timeoutMs: 5_000,
  requestId: "request-1",
  idempotencyKey: "logical-request-1",
};

describe("provider-neutral LLM adapters", () => {
  it.each([
    ["fake", () => createFakeProvider({ responses: [fixtureResponse()] })],
    ["openai", () => createOpenAIFixtureProvider("openai")],
    ["kimi", () => createOpenAIFixtureProvider("kimi")],
    ["anthropic", () => createAnthropicFixtureProvider()],
  ])("satisfies the execute contract for %s", async (_name, factory) => {
    const adapter = assertProviderAdapter(factory());
    expect(adapter.capabilities).toEqual(STANDARD_PROVIDER_CAPABILITIES);

    const response = await adapter.execute(baseContext);

    expect(response).toMatchObject({
      provider: adapter.id,
      model: adapter.model,
      requestId: "request-1",
      text: "I found an option.",
      usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
    });
    expect(response.toolCalls).toEqual([
      {
        id: "tool-1",
        name: "search_catalog",
        input: { query: "board" },
      },
    ]);
  });

  it.each([
    ["fake", () => createFakeProvider({ responses: [fixtureResponse()] })],
    [
      "openai",
      () => createOpenAIFixtureProvider("openai", { streaming: true }),
    ],
    ["kimi", () => createOpenAIFixtureProvider("kimi", { streaming: true })],
    ["anthropic", () => createAnthropicFixtureProvider({ streaming: true })],
  ])("satisfies the streaming contract for %s", async (_name, factory) => {
    const events = [];
    for await (const event of factory().stream(baseContext)) events.push(event);

    expect(events.at(-1)).toMatchObject({
      type: "response_completed",
      response: {
        text: "I found an option.",
        usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
      },
    });
    expect(
      events
        .filter((event) => event.type === "text_delta")
        .map((event) => event.delta)
        .join(""),
    ).toBe("I found an option.");
  });

  it("keeps OpenAI-only request fields out of Kimi requests", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(openAIResponse());
    const adapter = createOpenAICompatibleProvider({
      id: "kimi",
      apiKey: "test-key",
      model: "kimi-test",
      baseUrl: "https://api.moonshot.test/v1",
      fetchImpl,
    });

    await adapter.execute(baseContext);

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.store).toBeUndefined();
    expect(body.prompt_cache_key).toBe("logical-request-1");
    expect(body.tools[0].function.parameters).toEqual(
      baseContext.tools[0].inputSchema,
    );
  });
});

describe("LLM provider registry", () => {
  it("selects a configured provider deterministically", () => {
    expect(
      resolvePrimaryProvider(undefined, {
        OPENAI_API_KEY: "configured",
        KIMI_API_KEY: "configured",
        ANTHROPIC_API_KEY: "configured",
      }),
    ).toBe("openai");
    expect(
      resolvePrimaryProvider(undefined, { KIMI_API_KEY: "configured" }),
    ).toBe("kimi");
    expect(
      resolvePrimaryProvider(undefined, { ANTHROPIC_API_KEY: "configured" }),
    ).toBe("anthropic");
    expect(resolvePrimaryProvider("moonshot", {})).toBe("kimi");
    expect(resolvePrimaryProvider(undefined, { NODE_ENV: "test" })).toBe(
      "fake",
    );
  });

  it("reports configured providers without exposing credentials", () => {
    const registry = createProviderRegistry({
      env: { OPENAI_API_KEY: "configured", CLAUDE_API_KEY: "configured" },
    });
    expect(registry.configuredProviders()).toEqual([
      "openai",
      "anthropic",
      "fake",
    ]);
    expect(registry.capabilityMatrix.kimi.streaming).toBe(true);
  });
});

describe("provider-neutral LLM gateway", () => {
  it("retries a retryable provider failure before falling back", async () => {
    let attempts = 0;
    const responseFactory = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary provider failure");
      return {
        text: "Recovered on the bounded retry.",
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    });
    const gateway = createLLMGateway({
      adapter: createFakeProvider({ responseFactory }),
      env: {
        LLM_MAX_RETRIES: "1",
        FAKE_INPUT_COST_PER_MILLION_USD: "2",
        FAKE_OUTPUT_COST_PER_MILLION_USD: "4",
      },
    });

    const result = await gateway.runToolLoop({
      messages: [{ role: "user", content: "Find a board" }],
      merchantConfig: merchantConfig(),
      commerceContext: { id: "session-1" },
      tools: [],
    });

    expect(responseFactory).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      provider: "fake",
      retries: 1,
      costMicros: 40,
      text: "Recovered on the bounded retry.",
    });
  });

  it("does not retry or fall back after partial response text was emitted", async () => {
    const stream = vi.fn(async function* () {
      yield { type: "text_delta", delta: "Partial" };
      throw new Error("stream interrupted");
    });
    const primary = withProviderId(
      {
        ...createFakeProvider(),
        stream,
      },
      "primary",
    );
    const fallbackFactory = vi.fn(() => ({ text: "Must not run." }));
    const fallback = withProviderId(
      createFakeProvider({ responseFactory: fallbackFactory }),
      "fallback",
    );
    const gateway = createLLMGateway({
      adapter: primary,
      fallbackAdapters: [fallback],
      env: { LLM_MAX_RETRIES: "1" },
    });

    await expect(
      gateway.runToolLoop({
        messages: [{ role: "user", content: "Find a board" }],
        merchantConfig: merchantConfig(),
        commerceContext: { id: "session-1" },
        tools: [],
      }),
    ).rejects.toMatchObject({ code: "LLM_PARTIAL_STREAM", retryable: false });
    expect(stream).toHaveBeenCalledOnce();
    expect(fallbackFactory).not.toHaveBeenCalled();
  });

  it("falls back to another configured provider before any side effect starts", async () => {
    const primary = withProviderId(
      createFakeProvider({
        responseFactory: async () => {
          throw new Error("primary unavailable");
        },
      }),
      "primary",
    );
    const fallback = withProviderId(
      createFakeProvider({
        responses: [{ text: "Fallback response." }],
      }),
      "fallback",
    );
    const gateway = createLLMGateway({
      adapter: primary,
      fallbackAdapters: [fallback],
    });

    const result = await gateway.runToolLoop({
      messages: [{ role: "user", content: "Find a board" }],
      merchantConfig: merchantConfig(),
      commerceContext: { id: "session-1" },
      tools: [],
    });

    expect(result).toMatchObject({
      provider: "fallback",
      text: "Fallback response.",
    });
  });

  it("blocks provider fallback after a commerce side effect starts", async () => {
    const primary = withProviderId(
      createFakeProvider({
        responseFactory: async (_context, index) => {
          if (index === 0) {
            return {
              toolCalls: [
                {
                  id: "tool-1",
                  name: "update_cart",
                  input: {
                    productId: "product-1",
                    variantId: "variant-1",
                    quantity: 1,
                  },
                },
              ],
            };
          }
          throw new Error("primary unavailable after mutation");
        },
      }),
      "primary",
    );
    const fallbackFactory = vi.fn(() => ({ text: "Must not run." }));
    const fallback = withProviderId(
      createFakeProvider({ responseFactory: fallbackFactory }),
      "fallback",
    );
    const sideEffectState = createTurnSideEffectState();
    const gateway = createLLMGateway({
      adapter: primary,
      fallbackAdapters: [fallback],
    });

    await expect(
      gateway.runToolLoop({
        messages: [{ role: "user", content: "Add it" }],
        merchantConfig: merchantConfig(),
        commerceContext: { id: "session-1" },
        tools: [
          {
            name: "update_cart",
            description: "Update cart",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: true,
            },
          },
        ],
        sideEffectState,
        executeTool: async () => {
          sideEffectState.observe(SIDE_EFFECT_STATES.STARTED);
          return { type: "cart_updated", data: { cartId: "cart-1" } };
        },
      }),
    ).rejects.toMatchObject({
      code: "LLM_FALLBACK_BLOCKED_AFTER_SIDE_EFFECT",
      retryable: false,
    });
    expect(fallbackFactory).not.toHaveBeenCalled();
  });

  it("executes a tool loop and preserves the established result contract", async () => {
    const adapter = createFakeProvider({
      responses: [
        {
          toolCalls: [
            { id: "tool-1", name: "search_catalog", input: { query: "board" } },
          ],
          usage: { inputTokens: 3, outputTokens: 1 },
        },
        {
          text: "This board is the closest fit.",
          usage: { inputTokens: 4, outputTokens: 6 },
        },
      ],
    });
    const executeTool = vi.fn().mockResolvedValue({
      type: "catalog",
      data: [{ id: "product-1", title: "Board" }],
    });
    const chunks = [];
    const gateway = createLLMGateway({ adapter, timeoutMs: 5_000 });

    const result = await gateway.runToolLoop({
      messages: [{ role: "user", content: "Find a board" }],
      merchantConfig: merchantConfig(),
      commerceContext: { id: "session-1" },
      tools: [
        {
          name: "search_catalog",
          description: "Search products",
          input_schema: baseContext.tools[0].inputSchema,
        },
      ],
      executeTool,
      onText: (chunk) => chunks.push(chunk),
    });

    expect(result).toMatchObject({
      provider: "fake",
      model: "intentcart-fake-v1",
      text: "This board is the closest fit.",
      inputTokens: 7,
      outputTokens: 7,
    });
    expect(result.requestIds).toHaveLength(2);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolResults[0]).toMatchObject({
      ok: true,
      name: "search_catalog",
    });
    expect(executeTool).toHaveBeenCalledOnce();
    expect(chunks.join("")).toBe("This board is the closest fit.");
  });

  it("validates structured intent at the gateway boundary", async () => {
    const intent = {
      goal: "discover",
      category: "snowboard",
      useCase: null,
      budget: { min: null, max: 700, currency: "EUR" },
      attributes: {},
      preferences: ["all mountain"],
      exclusions: [],
      requestedProductIds: [],
      confidence: 0.8,
      missingInformation: [],
    };
    const gateway = createLLMGateway({
      adapter: createFakeProvider({
        responses: [{ text: JSON.stringify(intent) }],
      }),
    });

    await expect(
      gateway.generateStructuredIntent({
        message: "Find a board",
        session: {},
      }),
    ).resolves.toEqual(intent);
  });

  it("normalizes provider failures without leaking provider payloads", async () => {
    const adapter = createFakeProvider({
      responseFactory: async () => {
        throw Object.assign(new Error("sensitive upstream payload"), {
          status: 503,
        });
      },
    });
    const gateway = createLLMGateway({ adapter });

    await expect(
      gateway.generateStructuredIntent({ message: "hello", session: {} }),
    ).rejects.toBeInstanceOf(LLMGatewayError);
    await expect(
      gateway.generateStructuredIntent({ message: "hello", session: {} }),
    ).rejects.toMatchObject({
      code: "LLM_RESPONSE_INVALID",
      publicMessage: expect.any(String),
    });
  });

  it("reports cost only when both provider rates are configured", () => {
    expect(
      calculateCostMicros({
        provider: "openai",
        inputTokens: 1_000,
        outputTokens: 500,
        env: {
          OPENAI_INPUT_COST_PER_MILLION_USD: "2.5",
          OPENAI_OUTPUT_COST_PER_MILLION_USD: "10",
        },
      }),
    ).toBe(7_500);
    expect(
      calculateCostMicros({
        provider: "openai",
        inputTokens: 1_000,
        outputTokens: 500,
        env: {},
      }),
    ).toBeNull();
  });
});

function createOpenAIFixtureProvider(id, { streaming = false } = {}) {
  const model = `${id}-test-model`;
  const fetchImpl = vi
    .fn()
    .mockResolvedValue(
      streaming ? openAIStreamResponse(model) : openAIResponse(model),
    );
  return createOpenAICompatibleProvider({
    id,
    apiKey: "test-key",
    model,
    baseUrl: `https://${id}.test/v1`,
    fetchImpl,
  });
}

function openAIResponse(model = "openai-test-model") {
  return new Response(
    JSON.stringify({
      id: "response-1",
      model,
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: "I found an option.",
            tool_calls: [
              {
                id: "tool-1",
                type: "function",
                function: {
                  name: "search_catalog",
                  arguments: '{"query":"board"}',
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": "request-1",
      },
    },
  );
}

function openAIStreamResponse(model = "stream-test-model") {
  const chunks = [
    { id: "response-1", model, choices: [{ delta: { content: "I found " } }] },
    {
      id: "response-1",
      model,
      choices: [{ delta: { content: "an option." }, finish_reason: "stop" }],
    },
    {
      id: "response-1",
      model,
      choices: [],
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
    },
  ];
  const body =
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
    "data: [DONE]\n\n";
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "X-Request-Id": "request-1",
    },
  });
}

function createAnthropicFixtureProvider({ streaming = false } = {}) {
  const message = anthropicMessage();
  const client = {
    messages: {
      create: vi.fn().mockResolvedValue(message),
      stream: vi.fn(() => ({
        async *[Symbol.asyncIterator]() {
          if (streaming) {
            yield {
              type: "content_block_delta",
              delta: { type: "text_delta", text: "I found " },
            };
            yield {
              type: "content_block_delta",
              delta: { type: "text_delta", text: "an option." },
            };
          }
        },
        finalMessage: vi.fn().mockResolvedValue(message),
        abort: vi.fn(),
      })),
    },
  };
  return createAnthropicProvider({ client, model: "anthropic-test-model" });
}

function anthropicMessage() {
  return {
    id: "response-1",
    model: "anthropic-test-model",
    content: [
      { type: "text", text: "I found an option." },
      {
        type: "tool_use",
        id: "tool-1",
        name: "search_catalog",
        input: { query: "board" },
      },
    ],
    usage: { input_tokens: 12, output_tokens: 5 },
    stop_reason: "tool_use",
  };
}

function fixtureResponse() {
  return {
    text: "I found an option.",
    toolCalls: [
      { id: "tool-1", name: "search_catalog", input: { query: "board" } },
    ],
    usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
  };
}

function merchantConfig() {
  return {
    assistant: {
      name: "Sage",
      personality: "calm",
      brandVoice: "clear",
    },
    shopping: {
      recommendationRules: { maxProducts: 3 },
      outOfStockPolicy: "suggest alternatives",
    },
  };
}

function withProviderId(adapter, id) {
  return { ...adapter, id };
}
