import { randomUUID } from "node:crypto";
import systemPrompts from "../prompts/prompts.json";
import { ShoppingIntentSchema } from "../contracts/commerce.schemas.server";
import AppConfig from "./config.server";
import {
  assertProviderAdapter,
  LLMProviderError,
} from "./llm/provider-contract.server.js";
import { createProviderRegistry } from "./llm/provider-registry.server.js";

const DEFAULT_MAX_TOOL_ROUNDS = 5;
const DEFAULT_MAX_RETRIES = 1;

export class LLMGatewayError extends Error {
  constructor(
    code,
    message,
    { status = 502, provider, requestId, retryable = true, cause } = {},
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = "LLMGatewayError";
    this.code = code;
    this.status = status;
    this.provider = provider;
    this.requestId = requestId;
    this.retryable = retryable;
    this.publicMessage = "The shopping assistant is temporarily unavailable.";
  }
}

export function createLLMGateway({
  provider,
  apiKey,
  model,
  timeoutMs,
  adapter,
  fallbackAdapters = [],
  fallbackProviders,
  providerOptions = {},
  providerOptionsById = {},
  env = global.process?.env || {},
  registry = createProviderRegistry({ env }),
} = {}) {
  const effectiveTimeoutMs = boundedTimeout(
    timeoutMs ?? env.LLM_TIMEOUT_MS ?? AppConfig.api.llmTimeoutMs,
  );
  const maxRetries = boundedRetries(env.LLM_MAX_RETRIES);
  const providerId = adapter?.id || registry.resolvePrimaryId(provider);
  const llm = adapter
    ? assertProviderAdapter(adapter)
    : registry.create(providerId, {
        ...providerOptions,
        apiKey,
        model,
        timeoutMs: effectiveTimeoutMs,
      });
  const providerChain = [
    llm,
    ...fallbackAdapters.map(assertProviderAdapter),
    ...(!adapter && fallbackAdapters.length === 0
      ? registry.resolveFallbackIds(providerId, fallbackProviders).map((id) =>
          registry.create(id, {
            ...providerOptionsById[id],
            timeoutMs: effectiveTimeoutMs,
          }),
        )
      : []),
  ].filter(
    (candidate, index, values) =>
      values.findIndex((item) => item.id === candidate.id) === index,
  );

  async function runToolLoop({
    messages,
    promptType = AppConfig.api.defaultPromptType,
    merchantConfig,
    commerceContext,
    tools,
    executeTool,
    onText,
    onToolUse,
    signal,
    sideEffectState,
    maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS,
  }) {
    const history = normalizeMessages(messages);
    const toolDefinitions = normalizeTools(tools);
    const toolCalls = [];
    const toolResults = [];
    const responseText = [];
    const requestIds = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let retryCount = 0;
    const startedAt = Date.now();
    let providerIndex = 0;

    for (let round = 0; round < maxToolRounds; round += 1) {
      const requestId = randomUUID();
      requestIds.push(requestId);
      const streamed = await consumeWithFallback({
        providers: providerChain,
        startIndex: providerIndex,
        sideEffectState,
        maxRetries,
        context: {
          system: buildSystemInstruction(
            promptType,
            merchantConfig,
            commerceContext,
          ),
          messages: history,
          tools: toolDefinitions,
          maxTokens: AppConfig.api.maxTokens,
          timeoutMs: effectiveTimeoutMs,
          signal,
          requestId,
          idempotencyKey: commerceContext?.id
            ? `${commerceContext.id}:llm:${round}`
            : requestId,
        },
        onText: (delta) => {
          responseText.push(delta);
          onText?.(delta);
        },
      });
      const { response } = streamed;
      retryCount += streamed.retryCount;
      providerIndex = streamed.providerIndex;
      const activeProvider = providerChain[providerIndex];

      inputTokens += response.usage.inputTokens;
      outputTokens += response.usage.outputTokens;
      history.push({
        role: "assistant",
        content: response.text,
        toolCalls: response.toolCalls,
      });

      if (response.toolCalls.length === 0) {
        return {
          text: responseText.join(""),
          provider: activeProvider.id,
          model: response.model || activeProvider.model,
          requestId: response.requestId || requestId,
          requestIds,
          inputTokens,
          outputTokens,
          latencyMs: Date.now() - startedAt,
          costMicros: calculateCostMicros({
            provider: activeProvider.id,
            inputTokens,
            outputTokens,
            env,
          }),
          retries: retryCount,
          toolCalls,
          toolResults,
          stopReason: response.stopReason,
        };
      }
      if (typeof executeTool !== "function") {
        throw new LLMGatewayError(
          "TOOL_EXECUTOR_MISSING",
          "LLM requested a tool without an executor",
          {
            provider: activeProvider.id,
            requestId,
            status: 500,
            retryable: false,
          },
        );
      }

      for (const request of response.toolCalls) {
        toolCalls.push({
          id: request.id,
          name: request.name,
          input: request.input,
        });
        onToolUse?.({ name: request.name });

        try {
          const result = await executeTool(request.name, request.input);
          toolResults.push({
            id: request.id,
            name: request.name,
            ok: true,
            result: sanitizePersistedToolResult(result),
          });
          history.push({
            role: "tool",
            toolCallId: request.id,
            name: request.name,
            content: toModelToolResult(result),
            isError: false,
          });
        } catch (error) {
          const normalized = {
            code: error.code || "TOOL_FAILED",
            message:
              error.publicMessage || "The store action could not be completed.",
          };
          toolResults.push({
            id: request.id,
            name: request.name,
            ok: false,
            error: normalized,
          });
          history.push({
            role: "tool",
            toolCallId: request.id,
            name: request.name,
            content: JSON.stringify(normalized),
            isError: true,
          });
        }
      }
    }

    throw new LLMGatewayError(
      "TOOL_LOOP_LIMIT",
      "LLM tool loop exceeded its limit",
      {
        provider: providerChain[providerIndex]?.id || llm.id,
        status: 409,
        retryable: false,
      },
    );
  }

  async function generateStructuredIntent({ message, session, signal }) {
    const requestId = randomUUID();
    let lastError;
    for (const candidate of providerChain) {
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          const response = await candidate.execute({
            system:
              "Return only JSON matching the supplied shopping-intent shape. Preserve known constraints and never invent product IDs.",
            messages: [
              {
                role: "user",
                content: `Current state:\n${JSON.stringify(session || {})}\n\nShopper message:\n${message}`,
              },
            ],
            maxTokens: 700,
            timeoutMs: effectiveTimeoutMs,
            signal,
            requestId,
            idempotencyKey: requestId,
            responseFormat: SHOPPING_INTENT_RESPONSE_FORMAT,
          });
          return ShoppingIntentSchema.parse(parseJsonObject(response.text));
        } catch (error) {
          lastError = toGatewayError(error, candidate.id, requestId);
          if (!lastError.retryable || attempt >= maxRetries) break;
        }
      }
    }
    throw lastError;
  }

  return {
    provider: llm.id,
    model: llm.model,
    fallbackProviders: providerChain.slice(1).map((candidate) => candidate.id),
    capabilities: llm.capabilities,
    generateStructuredIntent,
    runToolLoop,
    streamShoppingResponse: runToolLoop,
  };
}

async function consumeWithFallback({
  providers,
  startIndex,
  sideEffectState,
  maxRetries,
  context,
  onText,
}) {
  let lastError;
  for (let index = startIndex; index < providers.length; index += 1) {
    const provider = providers[index];
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let emittedText = false;
      try {
        return {
          response: await consumeProviderStream(provider, context, (delta) => {
            emittedText = true;
            onText?.(delta);
          }),
          providerIndex: index,
          retryCount: attempt,
        };
      } catch (error) {
        lastError = error;
        if (emittedText) {
          throw new LLMGatewayError(
            "LLM_PARTIAL_STREAM",
            "Provider failed after response text was emitted",
            {
              provider: provider.id,
              requestId: context.requestId,
              status: 502,
              retryable: false,
              cause: error,
            },
          );
        }
        if (!canFallback(sideEffectState)) {
          throw new LLMGatewayError(
            "LLM_FALLBACK_BLOCKED_AFTER_SIDE_EFFECT",
            "Provider retry and fallback are blocked after a commerce side effect started",
            {
              provider: provider.id,
              requestId: context.requestId,
              status: 409,
              retryable: false,
              cause: error,
            },
          );
        }
        const normalized = toGatewayError(
          error,
          provider.id,
          context.requestId,
        );
        if (!normalized.retryable || attempt >= maxRetries) break;
      }
    }
  }
  throw lastError;
}

function canFallback(sideEffectState) {
  return !sideEffectState || sideEffectState.canFallback();
}

async function consumeProviderStream(adapter, context, onText) {
  let completed;
  try {
    for await (const event of adapter.stream(context)) {
      if (event?.type === "text_delta" && typeof event.delta === "string") {
        onText?.(event.delta);
      } else if (event?.type === "response_completed") {
        completed = event.response;
      }
    }
  } catch (error) {
    throw toGatewayError(error, adapter.id, context.requestId);
  }
  if (!completed) {
    throw new LLMGatewayError(
      "LLM_STREAM_INCOMPLETE",
      "LLM stream ended without a final response",
      {
        provider: adapter.id,
        requestId: context.requestId,
        status: 502,
      },
    );
  }
  return completed;
}

export function buildSystemInstruction(
  promptType,
  merchantConfig,
  commerceContext,
) {
  const base =
    systemPrompts.systemPrompts[promptType]?.content ||
    systemPrompts.systemPrompts[AppConfig.api.defaultPromptType].content;
  const assistant = merchantConfig.assistant;
  const shopping = merchantConfig.shopping;

  return [
    base,
    "Merchant configuration (authoritative):",
    `Assistant name: ${assistant.name}`,
    `Personality: ${assistant.personality}`,
    `Brand voice: ${assistant.brandVoice}`,
    `Maximum recommendations: ${shopping.recommendationRules.maxProducts}`,
    `Out-of-stock policy: ${shopping.outOfStockPolicy}`,
    "Use only registered tools for Shopify facts and actions.",
    "Never claim a cart mutation succeeded unless update_cart returned success.",
    "Before update_cart, ask for explicit confirmation of exact product, variant, and quantity.",
    "Recommend no more than three products and explain the main tradeoff.",
    `Commerce session (internal JSON): ${JSON.stringify(commerceContext)}`,
  ].join("\n\n");
}

function normalizeMessages(messages = []) {
  return messages
    .filter(
      (message) => message?.role === "user" || message?.role === "assistant",
    )
    .map((message) => ({
      role: message.role,
      content: normalizeContent(message.content),
    }))
    .filter(
      (message) =>
        typeof message.content !== "string" ||
        message.content.trim().length > 0,
    )
    .slice(-40);
}

function normalizeContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content;
  return JSON.stringify(content ?? "");
}

function normalizeTools(tools = []) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema || tool.input_schema,
  }));
}

function toModelToolResult(result) {
  return JSON.stringify({
    type: result?.type,
    data: result?.data,
    businessMessage: result?.businessMessage,
    references: result?.references,
    provider: result?.provider,
    requiresEscalation: result?.requiresEscalation,
    messages: result?.messages,
    warnings: result?.warnings,
    disclosures: result?.disclosures,
  }).slice(0, 50_000);
}

function sanitizePersistedToolResult(result) {
  return redactSensitiveValues({
    type: result?.type,
    data: result?.data,
    businessMessage: result?.businessMessage,
    references: result?.references,
    provider: result?.provider,
    requiresEscalation: result?.requiresEscalation,
    messages: result?.messages,
    warnings: result?.warnings,
    disclosures: result?.disclosures,
  });
}

function redactSensitiveValues(value, depth = 0) {
  if (depth > 7 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => redactSensitiveValues(item, depth + 1));
  }
  if (typeof value === "string") return value.slice(0, 10_000);
  if (typeof value !== "object") return value;

  const blocked =
    /(authorization|cookie|access.?token|refresh.?token|secret|password|email|phone|address)/i;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !blocked.test(key))
      .map(([key, item]) => [key, redactSensitiveValues(item, depth + 1)]),
  );
}

function parseJsonObject(value) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model did not return JSON");
  return JSON.parse(value.slice(start, end + 1));
}

function boundedTimeout(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(parsed, 1_000) : 45_000;
}

function boundedRetries(value) {
  const parsed = Number(value ?? DEFAULT_MAX_RETRIES);
  return Number.isInteger(parsed)
    ? Math.min(Math.max(parsed, 0), 2)
    : DEFAULT_MAX_RETRIES;
}

export function calculateCostMicros({
  provider,
  inputTokens,
  outputTokens,
  env,
}) {
  const prefix = String(provider || "").toUpperCase();
  const inputRate = optionalNonnegativeNumber(
    env?.[`${prefix}_INPUT_COST_PER_MILLION_USD`],
  );
  const outputRate = optionalNonnegativeNumber(
    env?.[`${prefix}_OUTPUT_COST_PER_MILLION_USD`],
  );
  if (inputRate === null || outputRate === null) return null;
  return Math.round(
    Number(inputTokens || 0) * inputRate +
      Number(outputTokens || 0) * outputRate,
  );
}

function optionalNonnegativeNumber(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function toGatewayError(error, provider, requestId) {
  if (error instanceof LLMGatewayError) return error;
  if (error instanceof LLMProviderError) {
    return new LLMGatewayError(error.code, error.message, {
      provider: error.provider || provider,
      requestId: error.requestId || requestId,
      status: error.status,
      retryable: error.retryable,
      cause: error,
    });
  }
  return new LLMGatewayError(
    "LLM_RESPONSE_INVALID",
    "LLM response was invalid",
    {
      provider,
      requestId,
      status: 502,
      retryable: true,
      cause: error,
    },
  );
}

const SHOPPING_INTENT_RESPONSE_FORMAT = Object.freeze({
  name: "shopping_intent",
  strict: false,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "goal",
      "category",
      "useCase",
      "budget",
      "attributes",
      "preferences",
      "exclusions",
      "requestedProductIds",
      "confidence",
      "missingInformation",
    ],
    properties: {
      goal: {
        type: "string",
        enum: [
          "discover",
          "compare",
          "product_question",
          "policy_question",
          "select_product",
          "select_variant",
          "update_cart",
          "checkout",
          "support",
          "unknown",
        ],
      },
      category: { type: ["string", "null"] },
      useCase: { type: ["string", "null"] },
      budget: {
        type: "object",
        additionalProperties: false,
        required: ["min", "max", "currency"],
        properties: {
          min: { type: ["number", "null"] },
          max: { type: ["number", "null"] },
          currency: { type: ["string", "null"] },
        },
      },
      attributes: { type: "object", additionalProperties: true },
      preferences: { type: "array", items: { type: "string" } },
      exclusions: { type: "array", items: { type: "string" } },
      requestedProductIds: { type: "array", items: { type: "string" } },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      missingInformation: { type: "array", items: { type: "string" } },
    },
  },
});
