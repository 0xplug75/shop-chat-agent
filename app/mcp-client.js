import { generateAuthUrl } from "./auth.server";
import { getCustomerToken } from "./db.server";
import AppConfig from "./services/config.server";

/**
 * Client for interacting with Model Context Protocol (MCP) API endpoints.
 * Manages connections to both customer and storefront MCP endpoints, and handles tool invocation.
 */
class MCPClient {
  /**
   * Creates a new MCPClient instance.
   *
   * @param {string} hostUrl - The base URL for the shop
   * @param {string} conversationId - ID for the current conversation
   * @param {string} shopId - ID of the Shopify shop
   */
  constructor(hostUrl, conversationId, shopId, customerMcpEndpoint) {
    this.tools = [];
    this.customerTools = [];
    this.storefrontTools = [];
    // TODO: Make this dynamic, for that first we need to allow access of mcp tools on password proteted demo stores.
    this.storefrontMcpEndpoint = `${hostUrl}/api/mcp`;

    const accountHostUrl = hostUrl.replace(/(\.myshopify\.com)$/, '.account$1');
    this.customerMcpEndpoint = customerMcpEndpoint || `${accountHostUrl}/customer/api/mcp`;
    this.customerAccessToken = "";
    this.conversationId = conversationId;
    this.shopId = shopId;
  }

  /**
   * Connects to the customer MCP server and retrieves available tools.
   * Attempts to use an existing token or will proceed without authentication.
   *
   * @returns {Promise<Array>} Array of available customer tools
   * @throws {Error} If connection to MCP server fails
   */
  async connectToCustomerServer() {
    try {
      console.log(`Connecting to MCP server at ${this.customerMcpEndpoint}`);

      if (this.conversationId) {
        const dbToken = await getCustomerToken(this.conversationId);

        if (dbToken && dbToken.accessToken) {
          this.customerAccessToken = dbToken.accessToken;
        } else {
          console.log("No token in database for conversation:", this.conversationId);
        }
      }

      // If we still don't have a token, we'll connect without one
      // and tools that require auth will prompt for it later
      const headers = {
        "Content-Type": "application/json",
        "Authorization": this.customerAccessToken || ""
      };

      const response = await this._makeJsonRpcRequest(
        this.customerMcpEndpoint,
        "tools/list",
        {},
        headers
      );

      // Extract tools from the JSON-RPC response format
      const toolsData = response.result && response.result.tools ? response.result.tools : [];
      const customerTools = this._formatToolsData(toolsData);

      this.customerTools = customerTools;
      this.tools = [...this.tools, ...customerTools];

      console.log(`[MCP] customer tools/list -> ${customerTools.length} tools: ${customerTools.map(t => t.name).join(', ')}`);

      return customerTools;
    } catch (e) {
      console.error("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  /**
   * Connects to the storefront MCP server and retrieves available tools.
   *
   * @returns {Promise<Array>} Array of available storefront tools
   * @throws {Error} If connection to MCP server fails
   */
  async connectToStorefrontServer() {
    try {
      console.log(`Connecting to MCP server at ${this.storefrontMcpEndpoint}`);

      const headers = {
        "Content-Type": "application/json"
      };

      const response = await this._makeJsonRpcRequest(
        this.storefrontMcpEndpoint,
        "tools/list",
        {},
        headers
      );

      // Extract tools from the JSON-RPC response format
      const toolsData = response.result && response.result.tools ? response.result.tools : [];
      const storefrontTools = this._formatToolsData(toolsData);

      this.storefrontTools = storefrontTools;
      this.tools = [...this.tools, ...storefrontTools];

      console.log(`[MCP] storefront tools/list -> ${storefrontTools.length} tools: ${storefrontTools.map(t => t.name).join(', ')}`);

      return storefrontTools;
    } catch (e) {
      console.error("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  /**
   * Dispatches a tool call to the appropriate MCP server based on the tool name.
   *
   * @param {string} toolName - Name of the tool to call
   * @param {Object} toolArgs - Arguments to pass to the tool
   * @returns {Promise<Object>} Result from the tool call
   * @throws {Error} If tool is not found or call fails
   */
  async callTool(toolName, toolArgs) {
    let result;
    if (this.customerTools.some(tool => tool.name === toolName)) {
      result = await this.callCustomerTool(toolName, toolArgs);
    } else if (this.storefrontTools.some(tool => tool.name === toolName)) {
      result = await this.callStorefrontTool(toolName, toolArgs);
    } else {
      console.error(`[MCP] callTool: "${toolName}" not found in known tools. customerTools=[${this.customerTools.map(t => t.name)}] storefrontTools=[${this.storefrontTools.map(t => t.name)}]`);
      throw new Error(`Tool ${toolName} not found`);
    }

    // TEMP DEBUG: surface raw response size / product count for the catalog
    // search tool so we can see whether Shopify is actually returning products.
    if (toolName === AppConfig.tools.productSearchName) {
      const text = result?.content?.[0]?.text;
      let productCount = "n/a";
      try {
        const parsed = typeof text === "string" ? JSON.parse(text) : text;
        productCount = Array.isArray(parsed?.products) ? parsed.products.length : "n/a";
      } catch (_e) {
        // leave as n/a
      }
      const size = JSON.stringify(result || {}).length;
      console.log(`[MCP] ${toolName} response: ~${size} bytes, products=${productCount}, error=${Boolean(result?.error)}`);
    }

    return result;
  }

  /**
   * Calls a tool on the storefront MCP server.
   *
   * @param {string} toolName - Name of the storefront tool to call
   * @param {Object} toolArgs - Arguments to pass to the tool
   * @returns {Promise<Object>} Result from the tool call
   * @throws {Error} If the tool call fails
   */
  async callStorefrontTool(toolName, toolArgs) {
    try {
      console.log("Calling storefront tool", toolName, toolArgs);

      const headers = {
        "Content-Type": "application/json"
      };

      const response = await this._makeJsonRpcRequest(
        this.storefrontMcpEndpoint,
        "tools/call",
        {
          name: toolName,
          arguments: toolArgs,
        },
        headers
      );

      return response.result || response;
    } catch (error) {
      console.error(`Error calling tool ${toolName}:`, error);
      throw error;
    }
  }

  /**
   * Calls a tool on the customer MCP server.
   * Handles authentication if needed.
   *
   * @param {string} toolName - Name of the customer tool to call
   * @param {Object} toolArgs - Arguments to pass to the tool
   * @returns {Promise<Object>} Result from the tool call or auth error
   * @throws {Error} If the tool call fails
   */
  async callCustomerTool(toolName, toolArgs) {
    try {
      console.log("Calling customer tool", toolName, toolArgs);
      // First try to get a token from the database for this conversation
      let accessToken = this.customerAccessToken;

      if (!accessToken || accessToken === "") {
        const dbToken = await getCustomerToken(this.conversationId);

        if (dbToken && dbToken.accessToken) {
          accessToken = dbToken.accessToken;
          this.customerAccessToken = accessToken; // Store it for later use
        } else {
          console.log("No token in database for conversation:", this.conversationId);
        }
      }

      const headers = {
        "Content-Type": "application/json",
        "Authorization": accessToken
      };

      try {
        const response = await this._makeJsonRpcRequest(
          this.customerMcpEndpoint,
          "tools/call",
          {
            name: toolName,
            arguments: toolArgs,
          },
          headers
        );

        return response.result || response;
      } catch (error) {
        // Handle 401 specifically to trigger authentication
        if (error.status === 401) {
          console.log("Unauthorized, generating authorization URL for customer");

          // Generate auth URL
          const authResponse = await generateAuthUrl(this.conversationId, this.shopId);

          // Instead of retrying, return the auth URL for the front-end
          return {
            error: {
              type: "auth_required",
              data: `You need to authorize the app to access your customer data. [Click here to authorize](${authResponse.url})`
            }
          };
        }

        // Re-throw other errors
        throw error;
      }
    } catch (error) {
      console.error(`Error calling tool ${toolName}:`, error);
      return {
        error: {
          type: "internal_error",
          data: `Error calling tool ${toolName}: ${error.message}`
        }
      };
    }
  }

  /**
   * Makes a JSON-RPC request to the specified endpoint.
   *
   * @private
   * @param {string} endpoint - The endpoint URL
   * @param {string} method - The JSON-RPC method to call
   * @param {Object} params - Parameters for the method
   * @param {Object} headers - HTTP headers for the request
   * @returns {Promise<Object>} Parsed JSON response
   * @throws {Error} If the request fails
   */
  async _makeJsonRpcRequest(endpoint, method, params, headers) {
    // TEMP DEBUG: timeout + timing instrumentation for MCP JSON-RPC calls.
    // Previously this fetch had no timeout at all, so an unreachable or
    // slow-to-respond MCP endpoint would hang the whole chat request forever
    // (infinite typing dots, no error surfaced).
    const timeoutMs = method === "tools/call"
      ? AppConfig.mcp.toolCallTimeoutMs
      : AppConfig.mcp.connectTimeoutMs;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    console.log(`[MCP] -> ${method} ${endpoint} (timeout ${timeoutMs}ms)`, params?.name ? { tool: params.name } : "");

    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: headers,
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: method,
          id: 1,
          params: params
        }),
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      if (error.name === "AbortError") {
        console.error(`[MCP] <- ${method} ${endpoint} TIMED OUT after ${durationMs}ms`);
        const timeoutError = new Error(`MCP request to ${endpoint} (${method}) timed out after ${timeoutMs}ms`);
        timeoutError.status = 504;
        throw timeoutError;
      }
      console.error(`[MCP] <- ${method} ${endpoint} network error after ${durationMs}ms:`, error.message);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    const durationMs = Date.now() - startedAt;

    if (!response.ok) {
      const error = await response.text();
      console.error(`[MCP] <- ${method} ${endpoint} failed ${response.status} after ${durationMs}ms: ${error}`);
      const errorObj = new Error(`Request failed: ${response.status} ${error}`);
      errorObj.status = response.status;
      throw errorObj;
    }

    const json = await response.json();
    const bodySize = JSON.stringify(json).length;
    console.log(`[MCP] <- ${method} ${endpoint} ok in ${durationMs}ms (response ~${bodySize} bytes)`);

    return json;
  }

  /**
   * Formats raw tool data into a consistent format.
   *
   * @private
   * @param {Array} toolsData - Raw tools data from the API
   * @returns {Array} Formatted tools data
   */
  _formatToolsData(toolsData) {
    return toolsData.map((tool) => {
      return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema || tool.input_schema,
      };
    });
  }
}

export default MCPClient;
