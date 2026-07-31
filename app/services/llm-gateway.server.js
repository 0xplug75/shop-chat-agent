import { Anthropic } from "@anthropic-ai/sdk";
import systemPrompts from "../prompts/prompts.json";
import AppConfig from "./config.server";
import { ShoppingIntentSchema } from "../contracts/commerce.schemas.server";

const DEFAULT_MAX_TOOL_ROUNDS = 5;

export class LLMGatewayError extends Error {
  constructor(code, message, { status = 502, cause } = {}) {
    super(message, { cause });
    this.name = "LLMGatewayError";
    this.code = code;
    this.status = status;
    this.publicMessage = "The shopping assistant is temporarily unavailable.";
  }
}

export function createLLMGateway({
  provider = process.env.AI_PROVIDER || "anthropic",
  apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY,
  model = process.env.ANTHROPIC_MODEL || AppConfig.api.defaultModel,
  timeoutMs = Number(process.env.LLM_TIMEOUT_MS || AppConfig.api.claudeStreamTimeoutMs)
} = {}) {
  if (provider !== "anthropic") {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");

  const client = new Anthropic({ apiKey });

  async function runToolLoop({
    messages,
    promptType = AppConfig.api.defaultPromptType,
    merchantConfig,
    commerceContext,
    tools,
    executeTool,
    onText,
    onToolUse,
    maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS
  }) {
    const history = normalizeMessages(messages);
    const toolCalls = [];
    const toolResults = [];
    const responseText = [];
    let inputTokens = 0;
    let outputTokens = 0;
    const startedAt = Date.now();

    for (let round = 0; round < maxToolRounds; round += 1) {
      const finalMessage = await streamMessage({
        client,
        model,
        timeoutMs,
        params: {
          model,
          max_tokens: AppConfig.api.maxTokens,
          system: buildSystemInstruction(promptType, merchantConfig, commerceContext),
          messages: history,
          tools: tools?.length ? tools : undefined
        },
        onText: (delta) => {
          responseText.push(delta);
          onText?.(delta);
        }
      });

      inputTokens += Number(finalMessage.usage?.input_tokens || 0);
      outputTokens += Number(finalMessage.usage?.output_tokens || 0);
      history.push({ role: "assistant", content: finalMessage.content });

      const requestedTools = finalMessage.content.filter((block) => block.type === "tool_use");
      if (requestedTools.length === 0) {
        return {
          text: responseText.join(""),
          model,
          inputTokens,
          outputTokens,
          latencyMs: Date.now() - startedAt,
          toolCalls,
          toolResults,
          stopReason: finalMessage.stop_reason
        };
      }

      const resultBlocks = [];
      for (const request of requestedTools) {
        toolCalls.push({ id: request.id, name: request.name, input: request.input });
        onToolUse?.({ name: request.name });

        try {
          const result = await executeTool(request.name, request.input);
          const modelResult = toModelToolResult(result);
          toolResults.push({
            id: request.id,
            name: request.name,
            ok: true,
            result: sanitizePersistedToolResult(result)
          });
          resultBlocks.push({
            type: "tool_result",
            tool_use_id: request.id,
            content: modelResult
          });
        } catch (error) {
          const normalized = {
            code: error.code || "TOOL_FAILED",
            message: error.publicMessage || "The store action could not be completed."
          };
          toolResults.push({ id: request.id, name: request.name, ok: false, error: normalized });
          resultBlocks.push({
            type: "tool_result",
            tool_use_id: request.id,
            is_error: true,
            content: JSON.stringify(normalized)
          });
        }
      }

      history.push({ role: "user", content: resultBlocks });
    }

    throw new LLMGatewayError("TOOL_LOOP_LIMIT", "LLM tool loop exceeded its limit", { status: 409 });
  }

  async function generateStructuredIntent({ message, session }) {
    const response = await createMessageWithTimeout(client, {
      model,
      max_tokens: 700,
      system: "Return only JSON matching the supplied shopping-intent shape. Preserve known constraints and never invent product IDs.",
      messages: [{
        role: "user",
        content: `Current state:\n${JSON.stringify(session || {})}\n\nShopper message:\n${message}\n\nRequired keys: goal, category, useCase, budget, attributes, preferences, exclusions, requestedProductIds, confidence, missingInformation.`
      }]
    }, timeoutMs);
    const text = response.content.find((block) => block.type === "text")?.text || "";
    return ShoppingIntentSchema.parse(parseJsonObject(text));
  }

  return {
    provider,
    model,
    generateStructuredIntent,
    runToolLoop,
    streamShoppingResponse: runToolLoop
  };
}

async function streamMessage({ client, params, timeoutMs, onText }) {
  let stream;
  try {
    stream = client.messages.stream(params);
    if (onText) stream.on("text", onText);
    return await withTimeout(stream.finalMessage(), timeoutMs, () => stream.abort());
  } catch (error) {
    if (error instanceof LLMGatewayError) throw error;
    const status = Number(error.status || 502);
    const code = status === 429 || status === 529 ? "LLM_RATE_LIMITED" : "LLM_FAILED";
    throw new LLMGatewayError(code, "Anthropic request failed", { status, cause: error });
  }
}

async function createMessageWithTimeout(client, params, timeoutMs) {
  const controller = new AbortController();
  try {
    return await withTimeout(
      client.messages.create(params, { signal: controller.signal }),
      timeoutMs,
      () => controller.abort()
    );
  } catch (error) {
    throw new LLMGatewayError("LLM_FAILED", "Anthropic request failed", {
      status: Number(error.status || 502),
      cause: error
    });
  }
}

function buildSystemInstruction(promptType, merchantConfig, commerceContext) {
  const base = systemPrompts.systemPrompts[promptType]?.content ||
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
    `Commerce session (internal JSON): ${JSON.stringify(commerceContext)}`
  ].join("\n\n");
}

function normalizeMessages(messages = []) {
  return messages
    .filter((message) => message?.role === "user" || message?.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: normalizeContent(message.content)
    }))
    .filter((message) => typeof message.content !== "string" || message.content.trim().length > 0)
    .slice(-40);
}

function normalizeContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content;
  return JSON.stringify(content ?? "");
}

function toModelToolResult(result) {
  const payload = {
    type: result.type,
    data: result.data,
    businessMessage: result.businessMessage,
    references: result.references
  };
  return JSON.stringify(payload).slice(0, 50_000);
}

function sanitizePersistedToolResult(result) {
  return redactSensitiveValues({
    type: result?.type,
    data: result?.data,
    businessMessage: result?.businessMessage,
    references: result?.references
  });
}

function redactSensitiveValues(value, depth = 0) {
  if (depth > 7 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redactSensitiveValues(item, depth + 1));
  }
  if (typeof value === "string") return value.slice(0, 10_000);
  if (typeof value !== "object") return value;

  const blocked = /(authorization|cookie|access.?token|refresh.?token|secret|password|email|phone|address)/i;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !blocked.test(key))
      .map(([key, item]) => [key, redactSensitiveValues(item, depth + 1)])
  );
}

function parseJsonObject(value) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model did not return JSON");
  return JSON.parse(value.slice(start, end + 1));
}

function withTimeout(promise, timeoutMs, onTimeout) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new LLMGatewayError("LLM_TIMEOUT", "LLM request timed out", { status: 504 }));
    }, Math.max(timeoutMs, 1_000));
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
