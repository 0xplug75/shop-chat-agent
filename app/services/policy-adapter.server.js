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

    return {
      toolName: AppConfig.tools.policySearchName,
      response
    };
  };

  return { searchPolicies };
}
