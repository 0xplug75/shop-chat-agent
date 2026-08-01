import {
  createAbortScope,
  LLMProviderError,
  normalizeProviderError,
  normalizeUsage,
  STANDARD_PROVIDER_CAPABILITIES,
} from "./provider-contract.server.js";

export function createOpenAICompatibleProvider({
  id = "openai",
  apiKey,
  model,
  baseUrl,
  fetchImpl = global.fetch,
  timeoutMs = 45_000,
}) {
  if (!apiKey) throw new Error(`${id.toUpperCase()} API key is required`);
  if (!model) throw new Error(`${id.toUpperCase()} model is required`);
  if (typeof fetchImpl !== "function")
    throw new Error("A fetch implementation is required");
  const endpoint = `${normalizeBaseUrl(baseUrl)}/chat/completions`;

  return {
    id,
    model,
    capabilities: STANDARD_PROVIDER_CAPABILITIES,

    async execute(context) {
      const scope = createAbortScope({
        signal: context.signal,
        timeoutMs: context.timeoutMs || timeoutMs,
      });
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: requestHeaders(apiKey, context),
          body: JSON.stringify(requestBody(context, model, false, id)),
          signal: scope.signal,
        });
        const body = await readJson(response);
        if (!response.ok)
          throw responseError(response, body, id, context.requestId);
        return normalizeCompletion(body, {
          provider: id,
          model,
          requestId: response.headers.get("x-request-id") || context.requestId,
        });
      } catch (error) {
        throw normalizeProviderError(error, {
          provider: id,
          requestId: context.requestId,
          timedOut: scope.timedOut,
        });
      } finally {
        scope.cleanup();
      }
    },

    async *stream(context) {
      const scope = createAbortScope({
        signal: context.signal,
        timeoutMs: context.timeoutMs || timeoutMs,
      });
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: requestHeaders(apiKey, context),
          body: JSON.stringify(requestBody(context, model, true, id)),
          signal: scope.signal,
        });
        if (!response.ok) {
          throw responseError(
            response,
            await readJson(response),
            id,
            context.requestId,
          );
        }
        if (!response.body) {
          throw new LLMProviderError(
            "LLM_STREAM_INVALID",
            "Provider returned no stream",
            {
              provider: id,
              requestId: context.requestId,
              status: 502,
            },
          );
        }

        const accumulator = createStreamAccumulator({
          provider: id,
          model,
          requestId: response.headers.get("x-request-id") || context.requestId,
        });
        for await (const payload of readServerSentEvents(response.body)) {
          if (payload === "[DONE]") break;
          const chunk = parseJson(
            payload,
            "stream chunk",
            id,
            context.requestId,
          );
          const delta = accumulator.add(chunk);
          if (delta) yield { type: "text_delta", delta };
        }
        yield { type: "response_completed", response: accumulator.complete() };
      } catch (error) {
        throw normalizeProviderError(error, {
          provider: id,
          requestId: context.requestId,
          timedOut: scope.timedOut,
        });
      } finally {
        scope.cleanup();
      }
    },
  };
}

function requestBody(context, model, streaming, provider) {
  return {
    model,
    messages: toOpenAIMessages(context),
    max_completion_tokens: context.maxTokens,
    stream: streaming,
    ...(streaming ? { stream_options: { include_usage: true } } : {}),
    ...(context.tools?.length
      ? {
          tools: context.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema || tool.input_schema,
              strict: false,
            },
          })),
          tool_choice: "auto",
        }
      : {}),
    ...(context.responseFormat
      ? {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: context.responseFormat.name,
              strict: context.responseFormat.strict ?? true,
              schema: context.responseFormat.schema,
            },
          },
        }
      : {}),
    ...(context.idempotencyKey
      ? { prompt_cache_key: context.idempotencyKey }
      : {}),
    ...(provider === "openai" ? { store: false } : {}),
  };
}

function toOpenAIMessages(context) {
  const messages = context.system
    ? [{ role: "system", content: context.system }]
    : [];
  for (const message of context.messages || []) {
    if (message.role === "tool") {
      messages.push({
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      });
    } else if (message.role === "assistant" && message.toolCalls?.length) {
      messages.push({
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((tool) => ({
          id: tool.id,
          type: "function",
          function: {
            name: tool.name,
            arguments: JSON.stringify(tool.input || {}),
          },
        })),
      });
    } else {
      messages.push({ role: message.role, content: message.content });
    }
  }
  return messages;
}

function normalizeCompletion(body, metadata) {
  const choice = body?.choices?.[0];
  if (!choice?.message) {
    throw new LLMProviderError(
      "LLM_RESPONSE_INVALID",
      "Provider returned no assistant message",
      {
        provider: metadata.provider,
        requestId: metadata.requestId,
        status: 502,
      },
    );
  }
  return {
    id: String(body.id || metadata.requestId || ""),
    provider: metadata.provider,
    model: String(body.model || metadata.model),
    requestId: metadata.requestId,
    text: choice.message.content || "",
    toolCalls: normalizeToolCalls(choice.message.tool_calls, metadata),
    usage: normalizeUsage(body.usage),
    stopReason: choice.finish_reason || null,
  };
}

function normalizeToolCalls(toolCalls = [], metadata) {
  return toolCalls.map((tool) => ({
    id: String(tool.id),
    name: String(tool.function?.name || ""),
    input: parseJson(
      tool.function?.arguments || "{}",
      "tool arguments",
      metadata.provider,
      metadata.requestId,
    ),
  }));
}

function createStreamAccumulator(metadata) {
  let id = "";
  let responseModel = metadata.model;
  let text = "";
  let stopReason = null;
  let usage = normalizeUsage();
  const tools = new Map();
  return {
    add(chunk) {
      id = chunk.id || id;
      responseModel = chunk.model || responseModel;
      if (chunk.usage) usage = normalizeUsage(chunk.usage);
      const choice = chunk.choices?.[0];
      if (!choice) return "";
      if (choice.finish_reason) stopReason = choice.finish_reason;
      const delta = choice.delta || {};
      const content = typeof delta.content === "string" ? delta.content : "";
      text += content;
      for (const call of delta.tool_calls || []) {
        const index = Number(call.index || 0);
        const current = tools.get(index) || { id: "", name: "", arguments: "" };
        current.id += call.id || "";
        current.name += call.function?.name || "";
        current.arguments += call.function?.arguments || "";
        tools.set(index, current);
      }
      return content;
    },
    complete() {
      return {
        id: String(id || metadata.requestId || ""),
        provider: metadata.provider,
        model: String(responseModel),
        requestId: metadata.requestId,
        text,
        toolCalls: [...tools.values()].map((tool) => ({
          id: tool.id,
          name: tool.name,
          input: parseJson(
            tool.arguments || "{}",
            "tool arguments",
            metadata.provider,
            metadata.requestId,
          ),
        })),
        usage,
        stopReason,
      };
    },
  };
}

async function* readServerSentEvents(body) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || "";
    for (const event of events) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (data) yield data;
    }
  }
  buffer += decoder.decode();
  const data = buffer
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (data) yield data;
}

function requestHeaders(apiKey, context) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(context.requestId ? { "X-Client-Request-Id": context.requestId } : {}),
    ...(context.idempotencyKey
      ? { "Idempotency-Key": context.idempotencyKey }
      : {}),
  };
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (
    !new Set(["http:", "https:"]).has(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("OpenAI-compatible base URL is invalid");
  }
  return url.toString().replace(/\/$/, "");
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
}

function responseError(response, _body, provider, requestId) {
  return new LLMProviderError(
    [429, 529].includes(response.status) ? "LLM_RATE_LIMITED" : "LLM_FAILED",
    `${provider} request was rejected`,
    {
      provider,
      requestId: response.headers.get("x-request-id") || requestId,
      status: response.status,
      retryable: ![400, 401, 403].includes(response.status),
    },
  );
}

function parseJson(value, label, provider, requestId) {
  try {
    return JSON.parse(value);
  } catch (cause) {
    throw new LLMProviderError(
      "LLM_RESPONSE_INVALID",
      `Provider returned invalid ${label}`,
      {
        provider,
        requestId,
        status: 502,
        retryable: true,
        cause,
      },
    );
  }
}
