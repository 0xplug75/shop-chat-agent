import AppConfig from "./config.server";
import { createToolService } from "./tool.server";

/**
 * Catalog Adapter
 * Wraps Shopify MCP catalog tools and normalizes product results for IntentCart.
 */
export function createCatalogAdapter(mcpClient) {
  const toolService = createToolService();

  const searchCatalog = async ({ query, context = {} }) => {
    const response = await mcpClient.callTool(AppConfig.tools.productSearchName, {
      catalog: {
        query,
        context: context.buyerContext,
        filters: context.catalogFilters,
        pagination: {
          limit: AppConfig.tools.maxProductsToDisplay
        }
      }
    });
    assertToolResponse(response);

    return {
      toolName: AppConfig.tools.productSearchName,
      response,
      products: toolService.processProductSearchResult(response)
    };
  };

  const lookupCatalog = async ({ ids = [], context = {} }) => {
    const query = ids.filter(Boolean).join(' ');
    return searchCatalog({ query, context });
  };

  const getProduct = async ({ id, selected, context = {} }) => {
    const query = selected?.title || id;
    const result = await searchCatalog({ query, context });
    const product = result.products.find((item) => item.id === id || item.product_id === id) || result.products[0] || null;

    return {
      ...result,
      product
    };
  };

  return {
    searchCatalog,
    lookupCatalog,
    getProduct
  };
}

function assertToolResponse(response) {
  if (!response?.error) return;
  const error = new Error("Shopify catalog request failed");
  error.code = response.error.type === "auth_required" ? "AUTH_REQUIRED" : "SHOPIFY_TOOL_FAILED";
  error.authorizationUrl = response.error.authorizationUrl;
  error.publicMessage = "The Shopify catalog is temporarily unavailable.";
  throw error;
}
