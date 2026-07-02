/**
 * Chat API Route
 * Handles chat interactions with Claude API and tools
 */
import MCPClient from "../mcp-client";
import { saveMessage, getConversationHistory, storeCustomerAccountUrls, getCustomerAccountUrls as getCustomerAccountUrlsFromDb } from "../db.server";
import AppConfig from "../services/config.server";
import { createSseStream } from "../services/streaming.server";
import { createClaudeService } from "../services/claude.server";
import { createToolService } from "../services/tool.server";
import {
  loadOrCreateCommerceSession,
  appendUserMessage,
  applyIntent,
  applyCatalogResults,
  applyCartState,
  applyCheckout,
  getCommerceContext
} from "../services/commerce-session.server";
import { createIntentRouter, INTENT_TYPES } from "../services/intent-router.server";
import { createCatalogAdapter } from "../services/catalog-adapter.server";
import { createPolicyAdapter } from "../services/policy-adapter.server";
import { createCartAdapter } from "../services/cart-adapter.server";
import { createCheckoutAdapter } from "../services/checkout-adapter.server";


/**
 * Rract Router loader function for handling GET requests
 */
export async function loader({ request }) {
  // Handle OPTIONS requests (CORS preflight)
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request)
    });
  }

  const url = new URL(request.url);

  // Handle history fetch requests - matches /chat?history=true&conversation_id=XYZ
  if (url.searchParams.has('history') && url.searchParams.has('conversation_id')) {
    return handleHistoryRequest(request, url.searchParams.get('conversation_id'));
  }

  // Handle SSE requests
  if (!url.searchParams.has('history') && request.headers.get("Accept") === "text/event-stream") {
    return handleChatRequest(request);
  }

  // API-only: reject all other requests
  return new Response(JSON.stringify({ error: AppConfig.errorMessages.apiUnsupported }), { status: 400, headers: getCorsHeaders(request) });
}

/**
 * React Router action function for handling POST requests
 */
export async function action({ request }) {
  return handleChatRequest(request);
}

/**
 * Handle history fetch requests
 * @param {Request} request - The request object
 * @param {string} conversationId - The conversation ID
 * @returns {Response} JSON response with chat history
 */
async function handleHistoryRequest(request, conversationId) {
  const messages = await getConversationHistory(conversationId);

  return new Response(JSON.stringify({ messages }), { headers: getCorsHeaders(request) });
}

/**
 * Handle chat requests (both GET and POST)
 * @param {Request} request - The request object
 * @returns {Response} Server-sent events stream
 */
async function handleChatRequest(request) {
  // TEMP DEBUG: confirm the POST actually reaches this route and see what
  // headers/host it arrived with, before any parsing/MCP/Claude work happens.
  console.log(`[chat] request received: ${request.method} ${request.url}`, {
    origin: request.headers.get("Origin"),
    shopId: request.headers.get("X-Shopify-Shop-Id"),
    accept: request.headers.get("Accept")
  });

  try {
    // Get message data from request body
    const body = await request.json();
    const userMessage = body.message;

    // Validate required message
    if (!userMessage) {
      return new Response(
        JSON.stringify({ error: AppConfig.errorMessages.missingMessage }),
        { status: 400, headers: getSseHeaders(request) }
      );
    }

    // Generate or use existing conversation ID
    const conversationId = body.conversation_id || Date.now().toString();
    const promptType = body.prompt_type || AppConfig.api.defaultPromptType;

    console.log(`[chat] parsed body: conversationId=${conversationId}, promptType=${promptType}, messageLength=${userMessage.length}`);

    // Create a stream for the response
    const responseStream = createSseStream(async (stream) => {
      await handleChatSession({
        request,
        userMessage,
        conversationId,
        promptType,
        stream
      });
    });

    return new Response(responseStream, {
      headers: getSseHeaders(request)
    });
  } catch (error) {
    console.error('Error in chat request handler:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: getCorsHeaders(request)
    });
  }
}

/**
 * Handle a complete chat session
 * @param {Object} params - Session parameters
 * @param {Request} params.request - The request object
 * @param {string} params.userMessage - The user's message
 * @param {string} params.conversationId - The conversation ID
 * @param {string} params.promptType - The prompt type
 * @param {Object} params.stream - Stream manager for sending responses
 */
async function handleChatSession({
  request,
  userMessage,
  conversationId,
  promptType,
  stream
}) {
  // Initialize services
  const claudeService = createClaudeService();
  const toolService = createToolService();
  const intentRouter = createIntentRouter();

  // Initialize MCP client
  const shopId = request.headers.get("X-Shopify-Shop-Id");
  const shopDomain = request.headers.get("Origin");

  console.log(`[chat] session: conversationId=${conversationId}, shopId=${shopId}, shopDomain(Origin)=${shopDomain}`);

  const customerAccountUrls = await getCustomerAccountUrls(shopDomain, conversationId);
  const mcpApiUrl = customerAccountUrls?.mcpApiUrl;

  const mcpClient = new MCPClient(
    shopDomain,
    conversationId,
    shopId,
    mcpApiUrl,
  );

  console.log(`[chat] resolved MCP endpoints: storefront=${mcpClient.storefrontMcpEndpoint}, customer=${mcpClient.customerMcpEndpoint}`);

  try {
    // Send conversation ID to client
    stream.sendMessage({ type: 'id', conversation_id: conversationId });

    // Connect to MCP servers and get available tools
    let storefrontMcpTools = [], customerMcpTools = [];

    try {
      storefrontMcpTools = await mcpClient.connectToStorefrontServer();
      customerMcpTools = await mcpClient.connectToCustomerServer();

      console.log(`Connected to MCP with ${storefrontMcpTools.length} tools`);
      console.log(`Connected to customer MCP with ${customerMcpTools.length} tools`);
    } catch (error) {
      console.warn('Failed to connect to MCP servers, continuing without tools:', error.message);
    }

    const commerceSession = await loadOrCreateCommerceSession({
      sessionId: conversationId,
      userMessage
    });

    await appendUserMessage(commerceSession, userMessage);

    const intent = intentRouter.route({ message: userMessage, session: commerceSession });
    applyIntent(commerceSession, intent);

    const adapters = {
      catalog: createCatalogAdapter(mcpClient),
      policy: createPolicyAdapter(mcpClient),
      cart: createCartAdapter(mcpClient),
      checkout: createCheckoutAdapter()
    };

    let productsToDisplay = [];
    await runCommerceIntent({
      intent,
      userMessage,
      commerceSession,
      adapters,
      productsToDisplay
    });

    let conversationHistory = commerceSession.messages;

    // Execute the conversation stream
    let finalMessage = { role: 'user', content: userMessage };

    while (finalMessage.stop_reason !== "end_turn") {
      console.log(`[chat] Claude call starting: conversationId=${conversationId}, history=${conversationHistory.length}, tools=${mcpClient.tools.length}`);
      finalMessage = await claudeService.streamConversation(
        {
          messages: conversationHistory,
          promptType,
          tools: mcpClient.tools,
          commerceContext: getCommerceContext(commerceSession)
        },
        {
          // Handle text chunks
          onText: (textDelta) => {
            stream.sendMessage({
              type: 'chunk',
              chunk: textDelta
            });
          },

          // Handle complete messages
          onMessage: (message) => {
            conversationHistory.push({
              role: message.role,
              content: message.content
            });

            saveMessage(conversationId, message.role, JSON.stringify(message.content))
              .catch((error) => {
                console.error("Error saving message to database:", error);
              });

            // Send a completion message
            stream.sendMessage({ type: 'message_complete' });
          },

          // Handle tool use requests
          onToolUse: async (content) => {
            const toolName = content.name;
            const toolArgs = content.input;
            const toolUseId = content.id;

            const toolUseMessage = `Calling tool: ${toolName} with arguments: ${JSON.stringify(toolArgs)}`;

            stream.sendMessage({
              type: 'tool_use',
              tool_use_message: toolUseMessage
            });

            if (toolName === AppConfig.tools.updateCartName && !isConfirmedCartMutation({ userMessage, toolArgs })) {
              await toolService.addToolResultToHistory(
                conversationHistory,
                toolUseId,
                'Cart update blocked: ask the shopper to explicitly confirm the exact product, variant, and quantity before calling update_cart. Do not change the cart yet.',
                conversationId
              );

              commerceSession.pendingBusinessMessages.push({
                outcome: 'requires_buyer_confirmation',
                rawMessage: userMessage,
                assistantMessage: 'Ask the shopper to confirm the exact product, variant, and quantity before adding anything to cart.'
              });

              stream.sendMessage({ type: 'new_message' });
              return;
            }

            // Call the tool
            const toolUseResponse = await mcpClient.callTool(toolName, toolArgs);

            // Handle tool response based on success/error
            if (toolUseResponse.error) {
              await toolService.handleToolError(
                toolUseResponse,
                toolName,
                toolUseId,
                conversationHistory,
                stream.sendMessage,
                conversationId
              );
            } else {
              await toolService.handleToolSuccess(
                toolUseResponse,
                toolName,
                toolUseId,
                conversationHistory,
                productsToDisplay,
                conversationId
              );

              const commerceToolResult = applyCommerceToolResult({
                commerceSession,
                toolName,
                toolUseResponse,
                toolService,
                checkoutAdapter: adapters.checkout
              });

              if (commerceToolResult?.checkoutUrl) {
                stream.sendMessage({
                  type: 'cart_state',
                  cartId: commerceSession.cartId,
                  checkoutUrl: commerceToolResult.checkoutUrl
                });
              }
            }

            // Signal new message to client
            stream.sendMessage({ type: 'new_message' });
          },

          // Handle content block completion
          onContentBlock: (contentBlock) => {
            if (contentBlock.type === 'text') {
              stream.sendMessage({
                type: 'content_block_complete',
                content_block: contentBlock
              });
            }
          }
        }
      );
      console.log(`[chat] Claude call finished: conversationId=${conversationId}, stopReason=${finalMessage.stop_reason}`);
    }

    // Signal end of turn
    stream.sendMessage({ type: 'end_turn' });

    // Send product results if available. The commerce-intent pre-fetch and
    // Claude's own tool call can both populate this list for the same
    // search, so de-dupe by product id before rendering cards.
    const uniqueProducts = Array.from(
      new Map(productsToDisplay.map((product) => [product.id || product.product_id, product])).values()
    );

    if (uniqueProducts.length > 0) {
      stream.sendMessage({
        type: 'product_results',
        products: uniqueProducts
      });
    }
  } catch (error) {
    // The streaming handler takes care of error handling
    throw error;
  }
}

async function runCommerceIntent({
  intent,
  userMessage,
  commerceSession,
  adapters,
  productsToDisplay
}) {
  try {
    if (intent.type === INTENT_TYPES.PRODUCT_DISCOVERY || intent.type === INTENT_TYPES.PRODUCT_DETAIL) {
      const catalogResult = await adapters.catalog.searchCatalog({
        query: userMessage,
        context: commerceSession.buyerContext
      });

      applyCatalogResults(commerceSession, catalogResult.products);
      productsToDisplay.push(...catalogResult.products);
      return;
    }

    if (intent.type === INTENT_TYPES.POLICY_QUESTION) {
      const policyResult = await adapters.policy.searchPolicies({
        query: userMessage,
        context: commerceSession.buyerContext
      });

      commerceSession.pendingBusinessMessages.push({
        outcome: 'policy_result',
        rawMessage: extractToolText(policyResult.response),
        assistantMessage: 'Shopify returned policy or FAQ information for this question.'
      });
      return;
    }

    if (intent.type === INTENT_TYPES.CHECKOUT_ACTION) {
      const checkoutResult = await adapters.checkout.createCheckoutFromCart({
        cartId: commerceSession.cartId,
        cartSnapshot: commerceSession.cartSnapshot
      });

      applyCheckout(commerceSession, checkoutResult);
    }
  } catch (error) {
    console.warn(`Commerce intent ${intent.type} could not be preprocessed:`, error.message);
    commerceSession.pendingBusinessMessages.push({
      outcome: 'adapter_error',
      rawMessage: error.message,
      assistantMessage: 'The commerce layer could not complete the pre-processing step. Use available Shopify tool results before making claims.'
    });
  }
}

function applyCommerceToolResult({
  commerceSession,
  toolName,
  toolUseResponse,
  toolService,
  checkoutAdapter
}) {
  if (toolName === AppConfig.tools.productSearchName) {
    applyCatalogResults(commerceSession, toolService.processProductSearchResult(toolUseResponse));
    return { type: 'catalog' };
  }

  if (toolName === AppConfig.tools.getCartName || toolName === AppConfig.tools.updateCartName) {
    const checkoutUrl = checkoutAdapter.getCheckoutUrlFromCartOrCheckout(toolUseResponse);

    applyCartState(commerceSession, {
      response: toolUseResponse,
      businessMessage: {
        outcome: 'cart_tool_result',
        rawMessage: extractToolText(toolUseResponse),
        assistantMessage: checkoutUrl
          ? `Shopify returned updated cart information. Checkout URL: ${checkoutUrl}`
          : 'Shopify returned updated cart information.'
      }
    });

    applyCheckout(commerceSession, {
      checkoutUrl
    });

    return {
      type: 'cart',
      checkoutUrl
    };
  }

  return null;
}

function isConfirmedCartMutation({ userMessage, toolArgs }) {
  const normalizedMessage = String(userMessage || '').toLowerCase();
  const hasExplicitConfirmation = [
    'yes',
    'confirmed',
    'i confirm',
    'confirm it',
    'go ahead',
    'add it',
    'add this',
    'add both',
    'add to cart',
    'ajoute',
    'ajouter',
    'oui',
    'je confirme',
    'vas-y'
  ].some((phrase) => normalizedMessage.includes(phrase));

  if (!hasExplicitConfirmation) return false;

  const addItems = Array.isArray(toolArgs?.add_items) ? toolArgs.add_items : [];
  const updateItems = Array.isArray(toolArgs?.update_items) ? toolArgs.update_items : [];

  const hasExactAddItems = addItems.length > 0 && addItems.every((item) =>
    Boolean(item?.product_variant_id) && Number(item?.quantity) > 0
  );

  const hasExactUpdateItems = updateItems.length > 0 && updateItems.every((item) =>
    Boolean(item?.id) && Number.isInteger(Number(item?.quantity))
  );

  return hasExactAddItems || hasExactUpdateItems;
}

function extractToolText(toolResponse) {
  if (!toolResponse) return '';
  if (typeof toolResponse === 'string') return toolResponse;
  if (Array.isArray(toolResponse.content)) {
    return toolResponse.content
      .map((item) => item?.text || item?.content || '')
      .filter(Boolean)
      .join('\n');
  }

  try {
    return JSON.stringify(toolResponse);
  } catch (_error) {
    return String(toolResponse);
  }
}

/**
 * Fetch with an AbortController-based timeout.
 * @param {string} url - The URL to fetch
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Response>} The fetch response
 */
async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Get the customer MCP API URL for a shop
 * @param {string} shopDomain - The shop domain
 * @param {string} conversationId - The conversation ID
 * @returns {string} The customer MCP API URL
 */
async function getCustomerAccountUrls(shopDomain, conversationId) {
  try {
    // Check if the customer account URL exists in the DB
    const existingUrls = await getCustomerAccountUrlsFromDb(conversationId);

    // If URL exists, return early with the MCP API URL
    if (existingUrls) return existingUrls;

    // If not, query for it from the Shopify API
    const { hostname } = new URL(shopDomain);
    console.log(`[chat] resolving customer account URLs for hostname=${hostname}`);

    // TEMP DEBUG: these well-known fetches had no timeout before, so an
    // unreachable/slow host would hang the whole request before MCP connect
    // logs are ever reached.
    const wellKnownFetch = (path) => fetchWithTimeout(`https://${hostname}${path}`, 10000).then(res => res.json());

    const urls = await Promise.all([
      wellKnownFetch('/.well-known/customer-account-api'),
      wellKnownFetch('/.well-known/openid-configuration'),
    ]).then(async ([mcpResponse, openidResponse]) => {
      const response = {
        mcpApiUrl: mcpResponse.mcp_api,
        authorizationUrl: openidResponse.authorization_endpoint,
        tokenUrl: openidResponse.token_endpoint,
      };

      await storeCustomerAccountUrls({
        conversationId,
        mcpApiUrl: mcpResponse.mcp_api,
        authorizationUrl: openidResponse.authorization_endpoint,
        tokenUrl: openidResponse.token_endpoint,
      });

      return response;
    });

    return urls;
  } catch (error) {
    console.error("Error getting customer MCP API URL:", error);
    return null;
  }
}

/**
 * Gets CORS headers for the response
 * @param {Request} request - The request object
 * @returns {Object} CORS headers object
 */
function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  const requestHeaders = request.headers.get("Access-Control-Request-Headers") || "Content-Type, Accept";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": requestHeaders,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400" // 24 hours
  };
}

/**
 * Get SSE headers for the response
 * @param {Request} request - The request object
 * @returns {Object} SSE headers object
 */
function getSseHeaders(request) {
  const origin = request.headers.get("Origin") || "*";

  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,OPTIONS,POST",
    "Access-Control-Allow-Headers": "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  };
}
