import { assertProviderAdapter } from "./provider-contract.server.js";
import { createAnthropicProvider } from "./anthropic-provider.server.js";
import { createFakeProvider } from "./fake-provider.server.js";
import { createOpenAICompatibleProvider } from "./openai-compatible-provider.server.js";

export const PROVIDER_CAPABILITY_MATRIX = Object.freeze({
  openai: Object.freeze({
    messages: true,
    structuredOutput: true,
    tools: true,
    streaming: true,
    usage: true,
    timeout: true,
    abort: true,
    requestId: true,
    logicalIdempotency: true,
  }),
  kimi: Object.freeze({
    messages: true,
    structuredOutput: true,
    tools: true,
    streaming: true,
    usage: true,
    timeout: true,
    abort: true,
    requestId: true,
    logicalIdempotency: true,
  }),
  anthropic: Object.freeze({
    messages: true,
    structuredOutput: true,
    tools: true,
    streaming: true,
    usage: true,
    timeout: true,
    abort: true,
    requestId: true,
    logicalIdempotency: true,
  }),
  fake: Object.freeze({
    messages: true,
    structuredOutput: true,
    tools: true,
    streaming: true,
    usage: true,
    timeout: true,
    abort: true,
    requestId: true,
    logicalIdempotency: true,
  }),
});

export function createProviderRegistry({
  env = global.process?.env || {},
} = {}) {
  return {
    resolvePrimaryId(explicitProvider) {
      return resolvePrimaryProvider(explicitProvider, env);
    },

    create(providerId, overrides = {}) {
      const id = normalizeProviderId(providerId);
      let adapter;
      if (id === "openai") {
        adapter = createOpenAICompatibleProvider({
          id,
          apiKey: overrides.apiKey || env.OPENAI_API_KEY,
          model: overrides.model || env.OPENAI_MODEL || "gpt-5.4-mini",
          baseUrl:
            overrides.baseUrl ||
            env.OPENAI_BASE_URL ||
            "https://api.openai.com/v1",
          fetchImpl: overrides.fetchImpl,
          timeoutMs: overrides.timeoutMs,
        });
      } else if (id === "kimi") {
        adapter = createOpenAICompatibleProvider({
          id,
          apiKey: overrides.apiKey || env.KIMI_API_KEY || env.MOONSHOT_API_KEY,
          model: overrides.model || env.KIMI_MODEL || "kimi-k3",
          baseUrl:
            overrides.baseUrl ||
            env.KIMI_BASE_URL ||
            "https://api.moonshot.ai/v1",
          fetchImpl: overrides.fetchImpl,
          timeoutMs: overrides.timeoutMs,
        });
      } else if (id === "anthropic") {
        adapter = createAnthropicProvider({
          apiKey:
            overrides.apiKey || env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY,
          model: overrides.model || env.ANTHROPIC_MODEL || "claude-sonnet-5",
          client: overrides.client,
          timeoutMs: overrides.timeoutMs,
        });
      } else {
        adapter = createFakeProvider(overrides);
      }
      return assertProviderAdapter(adapter);
    },

    configuredProviders() {
      return configuredProviderIds(env);
    },

    resolveFallbackIds(
      primaryId,
      explicitProviders = env.LLM_FALLBACK_PROVIDERS,
    ) {
      return parseProviderList(explicitProviders)
        .map(normalizeProviderId)
        .filter(
          (id, index, values) =>
            id !== primaryId && values.indexOf(id) === index,
        );
    },

    capabilityMatrix: PROVIDER_CAPABILITY_MATRIX,
  };
}

export function resolvePrimaryProvider(
  explicitProvider,
  env = global.process?.env || {},
) {
  const explicit = optional(explicitProvider) || optional(env.AI_PROVIDER);
  if (explicit) return normalizeProviderId(explicit);
  if (optional(env.OPENAI_API_KEY)) return "openai";
  if (optional(env.KIMI_API_KEY) || optional(env.MOONSHOT_API_KEY))
    return "kimi";
  if (optional(env.ANTHROPIC_API_KEY) || optional(env.CLAUDE_API_KEY))
    return "anthropic";
  if (env.NODE_ENV === "test") return "fake";
  throw new Error(
    "No LLM provider is configured. Set OPENAI_API_KEY, KIMI_API_KEY, or ANTHROPIC_API_KEY.",
  );
}

function configuredProviderIds(env) {
  return [
    ...(optional(env.OPENAI_API_KEY) ? ["openai"] : []),
    ...(optional(env.KIMI_API_KEY) || optional(env.MOONSHOT_API_KEY)
      ? ["kimi"]
      : []),
    ...(optional(env.ANTHROPIC_API_KEY) || optional(env.CLAUDE_API_KEY)
      ? ["anthropic"]
      : []),
    "fake",
  ];
}

function normalizeProviderId(value) {
  const id = String(value || "")
    .trim()
    .toLowerCase();
  if (id === "moonshot") return "kimi";
  if (!Object.hasOwn(PROVIDER_CAPABILITY_MATRIX, id)) {
    throw new Error(`Unsupported AI provider: ${value}`);
  }
  return id;
}

function optional(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseProviderList(value) {
  if (Array.isArray(value)) return value;
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
