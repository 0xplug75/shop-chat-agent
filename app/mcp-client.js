import { generateAuthUrl } from "./auth.server";
import AppConfig from "./services/config.server";
import { getCustomerToken } from "./services/customer-token.server";
import { fetchWithTimeout, readJsonResponseWithLimit } from "./lib/fetch-with-timeout.server";
import { createLogger } from "./lib/logger.server";
import { assertTrustedShopifyUrl, normalizeShopDomain } from "./security/shopify-domain.server";

export class McpRequestError extends Error {
  constructor(code, message, { status = 502 } = {}) {
    super(message);
    this.name = "McpRequestError";
    this.code = code;
    this.status = status;
    this.publicMessage = "Shopify could not complete the requested store action.";
  }
}

/**
 * Controlled transport for Shopify storefront and customer-account MCP.
 * The model never receives these raw tools; adapters expose the allow-listed
 * IntentCart registry instead.
 */
class MCPClient {
  constructor({ context, customerMcpEndpoint } = {}) {
    if (!context?.shopId || !context?.shopDomain) {
      throw new Error("Merchant context is required for MCP");
    }

    this.context = context;
    this.logger = createLogger({
      requestId: context.requestId,
      shopId: context.shopId,
      conversationId: context.conversationId
    });
    this.customerTools = [];
    this.storefrontTools = [];
    this.customerAccessToken = "";

    const shopDomain = normalizeShopDomain(context.shopDomain);
    this.storefrontMcpEndpoint = assertTrustedShopifyUrl(
      `https://${shopDomain}/api/mcp`,
      { shopDomain }
    ).toString();

    const accountHost = shopDomain.replace(/\.myshopify\.com$/, ".account.myshopify.com");
    this.customerMcpEndpoint = assertTrustedShopifyUrl(
      customerMcpEndpoint || `https://${accountHost}/customer/api/mcp`,
      { shopDomain }
    ).toString();
  }

  async initialize() {
    const [storefront, customer] = await Promise.allSettled([
      this.connectToStorefrontServer(),
      this.connectToCustomerServer()
    ]);

    if (storefront.status === "rejected") {
      this.logger.warn("Storefront MCP discovery failed", { error: storefront.reason });
    }
    if (customer.status === "rejected") {
      this.logger.warn("Customer MCP discovery failed", { error: customer.reason });
    }

    return {
      storefrontTools: this.storefrontTools,
      customerTools: this.customerTools
    };
  }

  async connectToStorefrontServer() {
    const response = await this.makeJsonRpcRequest(
      this.storefrontMcpEndpoint,
      "tools/list",
      {},
      { "Content-Type": "application/json" }
    );
    this.storefrontTools = this.formatTools(response.result?.tools || []);
    this.logger.info("Storefront MCP connected", { toolCount: this.storefrontTools.length });
    return this.storefrontTools;
  }

  async connectToCustomerServer() {
    const token = this.context.conversationId
      ? await getCustomerToken(this.context, { conversationId: this.context.conversationId })
      : null;
    this.customerAccessToken = token?.accessToken || "";

    const response = await this.makeJsonRpcRequest(
      this.customerMcpEndpoint,
      "tools/list",
      {},
      this.customerHeaders()
    );
    this.customerTools = this.formatTools(response.result?.tools || []);
    this.logger.info("Customer MCP connected", { toolCount: this.customerTools.length });
    return this.customerTools;
  }

  async callTool(toolName, toolArgs) {
    const isKnownCustomerTool = [
      AppConfig.tools.getCartName,
      AppConfig.tools.updateCartName
    ].includes(toolName);
    if (isKnownCustomerTool || this.customerTools.some((tool) => tool.name === toolName)) {
      return this.callCustomerTool(toolName, toolArgs);
    }
    if (this.storefrontTools.some((tool) => tool.name === toolName)) {
      return this.callStorefrontTool(toolName, toolArgs);
    }

    throw new McpRequestError("TOOL_NOT_AVAILABLE", `Shopify tool ${toolName} is unavailable`, {
      status: 409
    });
  }

  async callStorefrontTool(toolName, toolArgs) {
    const response = await this.makeJsonRpcRequest(
      this.storefrontMcpEndpoint,
      "tools/call",
      { name: toolName, arguments: toolArgs },
      { "Content-Type": "application/json" }
    );
    return response.result || response;
  }

  async callCustomerTool(toolName, toolArgs) {
    try {
      const response = await this.makeJsonRpcRequest(
        this.customerMcpEndpoint,
        "tools/call",
        { name: toolName, arguments: toolArgs },
        this.customerHeaders()
      );
      return response.result || response;
    } catch (error) {
      if (error.status !== 401) throw error;

      const authorization = await generateAuthUrl(
        this.context,
        this.context.conversationId
      );
      return {
        error: {
          type: "auth_required",
          authorizationUrl: authorization.url
        }
      };
    }
  }

  async makeJsonRpcRequest(endpoint, method, params, headers) {
    const trustedEndpoint = assertTrustedShopifyUrl(endpoint, {
      shopDomain: this.context.shopDomain
    }).toString();
    const timeoutMs = method === "tools/call"
      ? AppConfig.mcp.toolCallTimeoutMs
      : AppConfig.mcp.connectTimeoutMs;
    const startedAt = Date.now();

    let response;
    try {
      response = await fetchWithTimeout(trustedEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method,
          id: crypto.randomUUID(),
          params
        })
      }, timeoutMs);
    } catch (error) {
      this.logger.warn("MCP network request failed", {
        operation: method,
        durationMs: Date.now() - startedAt,
        timeout: Boolean(error.isTimeout)
      });
      throw new McpRequestError(
        error.isTimeout ? "MCP_TIMEOUT" : "MCP_NETWORK_ERROR",
        "Shopify MCP request failed",
        { status: error.isTimeout ? 504 : 502 }
      );
    }

    if (!response.ok) {
      this.logger.warn("MCP request rejected", {
        operation: method,
        status: response.status,
        upstreamRequestId: response.headers.get("x-request-id"),
        durationMs: Date.now() - startedAt
      });
      throw new McpRequestError("MCP_REJECTED", "Shopify MCP request was rejected", {
        status: response.status
      });
    }

    try {
      const payload = await readJsonResponseWithLimit(response, 2_000_000);
      if (payload?.error) {
        throw new McpRequestError("MCP_RPC_ERROR", "Shopify MCP returned an error", { status: 502 });
      }
      return payload;
    } catch (error) {
      if (error instanceof McpRequestError) throw error;
      throw new McpRequestError("MCP_INVALID_RESPONSE", "Shopify MCP returned an invalid response");
    }
  }

  customerHeaders() {
    return {
      "Content-Type": "application/json",
      ...(this.customerAccessToken
        ? { Authorization: `Bearer ${this.customerAccessToken.replace(/^Bearer\s+/i, "")}` }
        : {})
    };
  }

  formatTools(tools) {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema || tool.input_schema
    }));
  }
}

export default MCPClient;
