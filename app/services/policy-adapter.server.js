import AppConfig from "./config.server";

/**
 * Policy Adapter
 * Wraps Shopify MCP policy and FAQ search tools.
 */
export function createPolicyAdapter(mcpClient) {
  const searchPolicies = async ({ query, context = {} }) => {
    const response = await mcpClient.callTool(AppConfig.tools.policySearchName, {
      query,
      ...context.policyFilters
    });
    if (response?.error) {
      const error = new Error("Shopify policy request failed");
      error.code = response.error.type === "auth_required" ? "AUTH_REQUIRED" : "SHOPIFY_TOOL_FAILED";
      error.authorizationUrl = response.error.authorizationUrl;
      error.publicMessage = "Store information is temporarily unavailable.";
      throw error;
    }

    return {
      toolName: AppConfig.tools.policySearchName,
      response
    };
  };

  return { searchPolicies };
}
