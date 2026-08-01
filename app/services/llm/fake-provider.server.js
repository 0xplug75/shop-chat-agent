import {
  normalizeUsage,
  STANDARD_PROVIDER_CAPABILITIES,
} from "./provider-contract.server.js";

export function createFakeProvider({
  model = "intentcart-fake-v1",
  responses = [],
  responseFactory,
} = {}) {
  let callIndex = 0;

  async function next(context) {
    if (context.signal?.aborted) {
      const error = new Error("Fake provider request aborted");
      error.name = "AbortError";
      throw error;
    }
    const configured = responseFactory
      ? await responseFactory(context, callIndex)
      : responses[callIndex];
    callIndex += 1;
    return normalizeFakeResponse(configured || defaultResponse(context), {
      model,
      requestId: context.requestId,
      callIndex,
    });
  }

  return {
    id: "fake",
    model,
    capabilities: STANDARD_PROVIDER_CAPABILITIES,
    execute: next,
    async *stream(context) {
      const response = await next(context);
      if (response.text) yield { type: "text_delta", delta: response.text };
      yield { type: "response_completed", response };
    },
  };
}

function defaultResponse(context) {
  if (context.responseFormat?.name === "shopping_intent") {
    return {
      text: JSON.stringify({
        goal: "unknown",
        category: null,
        useCase: null,
        budget: { min: null, max: null, currency: null },
        attributes: {},
        preferences: [],
        exclusions: [],
        requestedProductIds: [],
        confidence: 0,
        missingInformation: ["category"],
      }),
    };
  }
  return { text: "Deterministic shopping assistant response." };
}

function normalizeFakeResponse(response, metadata) {
  return {
    id: response.id || `fake-${metadata.callIndex}`,
    provider: "fake",
    model: response.model || metadata.model,
    requestId: metadata.requestId,
    text: response.text || "",
    toolCalls: (response.toolCalls || []).map((tool, index) => ({
      id: tool.id || `fake-tool-${metadata.callIndex}-${index}`,
      name: tool.name,
      input: tool.input || {},
    })),
    usage: normalizeUsage(
      response.usage || {
        inputTokens: 1,
        outputTokens: response.text ? 1 : 0,
      },
    ),
    stopReason:
      response.stopReason || (response.toolCalls?.length ? "tool_use" : "stop"),
  };
}
