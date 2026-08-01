export const STANDARD_PROVIDER_CAPABILITIES = Object.freeze({
  messages: true,
  structuredOutput: true,
  tools: true,
  streaming: true,
  usage: true,
  timeout: true,
  abort: true,
  requestId: true,
  logicalIdempotency: true,
});

export class LLMProviderError extends Error {
  constructor(
    code,
    message,
    { provider, status = 502, retryable = true, requestId, cause } = {},
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = "LLMProviderError";
    this.code = code;
    this.provider = provider;
    this.status = status;
    this.retryable = retryable;
    this.requestId = requestId;
  }
}

export function assertProviderAdapter(adapter) {
  if (!adapter?.id || !adapter?.model) {
    throw new Error("LLM provider adapters require id and model");
  }
  if (
    typeof adapter.execute !== "function" ||
    typeof adapter.stream !== "function"
  ) {
    throw new Error(
      `LLM provider ${adapter.id} must implement execute and stream`,
    );
  }
  for (const capability of Object.keys(STANDARD_PROVIDER_CAPABILITIES)) {
    if (typeof adapter.capabilities?.[capability] !== "boolean") {
      throw new Error(`LLM provider ${adapter.id} must declare ${capability}`);
    }
  }
  return adapter;
}

export function normalizeUsage(usage = {}) {
  const inputTokens = Number(
    usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens ?? 0,
  );
  const outputTokens = Number(
    usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens ?? 0,
  );
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
    totalTokens:
      Number(
        usage.totalTokens ?? usage.total_tokens ?? inputTokens + outputTokens,
      ) || 0,
  };
}

export function createAbortScope({ signal, timeoutMs = 45_000 } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    Math.max(Number(timeoutMs) || 0, 1_000),
  );

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

export function normalizeProviderError(
  error,
  { provider, requestId, timedOut = false } = {},
) {
  if (error instanceof LLMProviderError) return error;
  const status = Number(error?.status || error?.response?.status || 502);
  const aborted = error?.name === "AbortError";
  const code = timedOut
    ? "LLM_TIMEOUT"
    : aborted
      ? "LLM_ABORTED"
      : [429, 529].includes(status)
        ? "LLM_RATE_LIMITED"
        : status === 401 || status === 403
          ? "LLM_AUTH_FAILED"
          : "LLM_FAILED";
  return new LLMProviderError(code, `${provider || "LLM"} request failed`, {
    provider,
    requestId,
    status: timedOut ? 504 : status,
    retryable: ![401, 403].includes(status),
    cause: error,
  });
}
