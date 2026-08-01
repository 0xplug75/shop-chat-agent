import { Anthropic } from "@anthropic-ai/sdk";
import {
  createAbortScope,
  normalizeProviderError,
  normalizeUsage,
  STANDARD_PROVIDER_CAPABILITIES,
} from "./provider-contract.server.js";

export function createAnthropicProvider({
  apiKey,
  model,
  client,
  timeoutMs = 45_000,
}) {
  if (!client && !apiKey) throw new Error("ANTHROPIC_API_KEY is required");
  if (!model) throw new Error("ANTHROPIC_MODEL is required");
  const anthropic = client || new Anthropic({ apiKey });

  return {
    id: "anthropic",
    model,
    capabilities: STANDARD_PROVIDER_CAPABILITIES,

    async execute(context) {
      const scope = createAbortScope({
        signal: context.signal,
        timeoutMs: context.timeoutMs || timeoutMs,
      });
      try {
        const response = await anthropic.messages.create(
          requestBody(context, model),
          requestOptions(context, scope.signal),
        );
        return normalizeMessage(response, context.requestId, model);
      } catch (error) {
        throw normalizeProviderError(error, {
          provider: "anthropic",
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
      let messageStream;
      try {
        messageStream = anthropic.messages.stream(
          requestBody(context, model),
          requestOptions(context, scope.signal),
        );
        for await (const event of messageStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta?.type === "text_delta" &&
            event.delta.text
          ) {
            yield { type: "text_delta", delta: event.delta.text };
          }
        }
        const finalMessage = await messageStream.finalMessage();
        yield {
          type: "response_completed",
          response: normalizeMessage(finalMessage, context.requestId, model),
        };
      } catch (error) {
        if (scope.timedOut) messageStream?.abort?.();
        throw normalizeProviderError(error, {
          provider: "anthropic",
          requestId: context.requestId,
          timedOut: scope.timedOut,
        });
      } finally {
        scope.cleanup();
      }
    },
  };
}

function requestBody(context, model) {
  return {
    model,
    max_tokens: context.maxTokens,
    system: structuredSystem(context),
    messages: toAnthropicMessages(context.messages),
    ...(context.tools?.length
      ? {
          tools: context.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema || tool.input_schema,
          })),
        }
      : {}),
  };
}

function structuredSystem(context) {
  if (!context.responseFormat) return context.system;
  return [
    context.system,
    `Return only JSON matching this schema: ${JSON.stringify(context.responseFormat.schema)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function toAnthropicMessages(messages = []) {
  const converted = [];
  for (const message of messages) {
    if (message.role === "tool") {
      const block = {
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content,
        ...(message.isError ? { is_error: true } : {}),
      };
      const previous = converted.at(-1);
      if (previous?.role === "user" && Array.isArray(previous.content)) {
        previous.content.push(block);
      } else {
        converted.push({ role: "user", content: [block] });
      }
    } else if (message.role === "assistant" && message.toolCalls?.length) {
      converted.push({
        role: "assistant",
        content: [
          ...(message.content ? [{ type: "text", text: message.content }] : []),
          ...message.toolCalls.map((tool) => ({
            type: "tool_use",
            id: tool.id,
            name: tool.name,
            input: tool.input || {},
          })),
        ],
      });
    } else {
      converted.push({ role: message.role, content: message.content });
    }
  }
  return converted;
}

function normalizeMessage(message, requestId, fallbackModel) {
  const content = message.content || [];
  return {
    id: String(message.id || requestId || ""),
    provider: "anthropic",
    model: String(message.model || fallbackModel),
    requestId,
    text: content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join(""),
    toolCalls: content
      .filter((block) => block.type === "tool_use")
      .map((block) => ({
        id: block.id,
        name: block.name,
        input: block.input || {},
      })),
    usage: normalizeUsage(message.usage),
    stopReason: message.stop_reason || null,
  };
}

function requestOptions(context, signal) {
  return {
    signal,
    headers: {
      ...(context.requestId
        ? { "X-Client-Request-Id": context.requestId }
        : {}),
      ...(context.idempotencyKey
        ? { "Idempotency-Key": context.idempotencyKey }
        : {}),
    },
  };
}
