/**
 * Claude Service
 * Manages interactions with the Claude API
 */
import { Anthropic } from "@anthropic-ai/sdk";
import AppConfig from "./config.server";
import systemPrompts from "../prompts/prompts.json";
import { getMerchantConfig } from "../merchant/merchant.server";

/**
 * Creates a Claude service instance
 * @param {string} apiKey - Claude API key
 * @returns {Object} Claude service with methods for interacting with Claude API
 */
export function createClaudeService(apiKey = process.env.CLAUDE_API_KEY) {
  // TEMP DEBUG: confirm the key actually loaded from env (never log the value)
  console.log(`[claude] CLAUDE_API_KEY loaded: ${Boolean(apiKey)}${apiKey ? ` (len=${apiKey.length})` : ''}`);

  // Initialize Claude client
  const anthropic = new Anthropic({ apiKey });

  /**
   * Streams a conversation with Claude
   * @param {Object} params - Stream parameters
   * @param {Array} params.messages - Conversation history
   * @param {string} params.promptType - The type of system prompt to use
   * @param {Array} params.tools - Available tools for Claude
   * @param {Object} streamHandlers - Stream event handlers
   * @param {Function} streamHandlers.onText - Handles text chunks
   * @param {Function} streamHandlers.onMessage - Handles complete messages
   * @param {Function} streamHandlers.onToolUse - Handles tool use requests
   * @returns {Promise<Object>} The final message
   */
  const streamConversation = async ({
    messages,
    promptType = AppConfig.api.defaultPromptType,
    tools,
    commerceContext
  }, streamHandlers) => {
    // Get system prompt from configuration or use default
    const systemInstruction = buildSystemInstruction(promptType, commerceContext);

    console.log(`[claude] streamConversation start: promptType=${promptType}, messages=${messages?.length ?? 0}, tools=${tools?.length ?? 0}`);
    const startedAt = Date.now();

    // Create stream
    const stream = await anthropic.messages.stream({
      model: AppConfig.api.defaultModel,
      max_tokens: AppConfig.api.maxTokens,
      system: systemInstruction,
      messages,
      tools: tools && tools.length > 0 ? tools : undefined
    });

    // Set up event handlers
    if (streamHandlers.onText) {
      stream.on('text', streamHandlers.onText);
    }

    if (streamHandlers.onMessage) {
      stream.on('message', streamHandlers.onMessage);
    }

    if (streamHandlers.onContentBlock) {
      stream.on('contentBlock', streamHandlers.onContentBlock);
    }

    // TEMP DEBUG: race the Claude stream against a hard timeout so a stalled
    // Anthropic connection (or one that never emits 'end') surfaces as a
    // visible error instead of leaving the client's typing indicator forever.
    const timeoutMs = AppConfig.api.claudeStreamTimeoutMs;
    let timeoutId;
    const timeoutPromise = new Promise((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        console.error(`[claude] streamConversation TIMED OUT after ${timeoutMs}ms, aborting stream`);
        stream.abort();
        reject(new Error(`Claude stream timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    let finalMessage;
    try {
      finalMessage = await Promise.race([stream.finalMessage(), timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }

    console.log(`[claude] streamConversation done in ${Date.now() - startedAt}ms: stop_reason=${finalMessage.stop_reason}, content_blocks=${finalMessage.content?.length ?? 0}`);

    // Process tool use requests
    if (streamHandlers.onToolUse && finalMessage.content) {
      for (const content of finalMessage.content) {
        if (content.type === "tool_use") {
          console.log(`[claude] tool_use requested: ${content.name}`, content.input);
          await streamHandlers.onToolUse(content);
        }
      }
    }

    return finalMessage;
  };

  /**
   * Gets the system prompt content for a given prompt type
   * @param {string} promptType - The prompt type to retrieve
   * @returns {string} The system prompt content
   */
  const getSystemPrompt = (promptType) => {
    return systemPrompts.systemPrompts[promptType]?.content ||
      systemPrompts.systemPrompts[AppConfig.api.defaultPromptType].content;
  };

  /**
   * Builds the full system instruction, grounding Claude in the current
   * commerce session state without adding it as a conversation turn
   * (the Messages API rejects consecutive same-role messages).
   * @param {string} promptType - The prompt type to retrieve
   * @param {Object} [commerceContext] - Current commerce session state
   * @returns {string} The system instruction sent to Claude
   */
  const buildSystemInstruction = (promptType, commerceContext) => {
    const systemPrompt = getSystemPrompt(promptType);
    const merchantConfig = getMerchantConfig();
    const assistantConfig = merchantConfig.assistant;
    const shoppingConfig = merchantConfig.shopping;
    const merchantInstruction = [
      "Merchant configuration (internal, authoritative):",
      `- Assistant name: ${assistantConfig.name}`,
      `- Personality: ${assistantConfig.personality}`,
      `- Brand voice: ${assistantConfig.brandVoice}`,
      `- Recommendation max products: ${shoppingConfig.recommendationRules.maxProducts}`,
      `- Bundle strategy: ${shoppingConfig.bundleStrategy}`,
      `- Out-of-stock policy: ${shoppingConfig.outOfStockPolicy}`
    ].join("\n");

    if (!commerceContext) {
      return `${systemPrompt}\n\n${merchantInstruction}`;
    }

    return `${systemPrompt}\n\n${merchantInstruction}\n\nCommerce session context (internal, factual - do not repeat as raw JSON to the shopper):\n${JSON.stringify(commerceContext)}`;
  };

  return {
    streamConversation,
    getSystemPrompt
  };
}
