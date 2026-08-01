/**
 * Configuration Service
 * Centralizes all configuration values for the chat service
 */

export const AppConfig = {
  // API Configuration
  api: {
    defaultModel: "gpt-5.4-mini",
    maxTokens: 2000,
    defaultPromptType: "agenticBuyingAssistant",
    // Hard cap for every provider request so a stalled stream cannot leave the
    // storefront in an infinite loading state.
    llmTimeoutMs: 45000,
  },

  // TEMP DEBUG: network timeouts for MCP calls (tools/list, tools/call, and
  // well-known discovery fetches). None of these had timeouts before, so a
  // stalled/unreachable MCP endpoint would hang the request forever.
  mcp: {
    connectTimeoutMs: 12000,
    toolCallTimeoutMs: 20000,
  },

  // Error Message Templates
  errorMessages: {
    missingMessage: "Message is required",
    apiUnsupported:
      "This endpoint only supports server-sent events (SSE) requests or history requests.",
    authFailed: "Authentication failed with Claude API",
    apiKeyError: "Please check your API key in environment variables",
    rateLimitExceeded: "Rate limit exceeded",
    rateLimitDetails: "Please try again later",
    genericError: "Failed to get response from Claude",
  },

  // Tool Configuration
  tools: {
    productSearchName: "search_catalog",
    policySearchName: "search_shop_policies_and_faqs",
    getCartName: "get_cart",
    updateCartName: "update_cart",
    maxProductsToDisplay: 3,
  },
};

export default AppConfig;
