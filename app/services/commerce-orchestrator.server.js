import MCPClient from "../mcp-client";
import { createLogger } from "../lib/logger.server";
import { getMerchantConfig } from "../merchant/merchant.server";
import { withConversationContext } from "../security/merchant-context.server";
import {
  appendAssistantMessage,
  appendUserMessage,
  applyIntentToCommerceSession,
  getCommerceContext,
  getOrCreateCommerceSession,
  updateCommerceSession
} from "./commerce-session.server";
import { createIntentEngine } from "./intent-router.server";
import { createLLMGateway } from "./llm-gateway.server";
import { createKnowledgeService } from "./knowledge.server";
import { createCatalogAdapter } from "./catalog-adapter.server";
import { createPolicyAdapter } from "./policy-adapter.server";
import { createCartAdapter } from "./cart-adapter.server";
import { createCheckoutAdapter } from "./checkout-adapter.server";
import { createToolRegistry } from "./tool-registry.server";
import { recordCommerceEvent } from "./analytics-event.server";
import { resolveCustomerAccountUrls } from "./customer-account-discovery.server";

export function createCommerceOrchestrator({
  intentEngine,
  llmGateway,
  knowledgeService = createKnowledgeService()
} = {}) {
  const gateway = llmGateway || createLLMGateway();
  const effectiveIntentEngine = intentEngine || createIntentEngine({ llmGateway: gateway });

  return {
    async handleTurn({
      context: baseContext,
      message,
      conversationId,
      visitorId,
      promptType,
      stream
    }) {
      const startedAt = Date.now();
      let session = await getOrCreateCommerceSession(baseContext, {
        conversationId,
        visitorId
      });
      const context = withConversationContext(baseContext, session.conversationId);
      const logger = createLogger({
        requestId: context.requestId,
        shopId: context.shopId,
        conversationId: session.conversationId,
        commerceSessionId: session.id
      });
      const isNewConversation = session.messages.length === 0;

      stream?.sendMessage({ type: "id", conversation_id: session.conversationId });
      await appendUserMessage(context, session, message);
      session = {
        ...session,
        messages: [...session.messages, { role: "user", content: message }]
      };
      await safeEvent(context, logger, {
        eventType: "message_sent",
        conversationId: session.conversationId,
        commerceSessionId: session.id,
        payload: { channel: "STOREFRONT_WIDGET" }
      });
      if (isNewConversation) {
        await safeEvent(context, logger, {
          eventType: "conversation_started",
          conversationId: session.conversationId,
          commerceSessionId: session.id,
          payload: { channel: "STOREFRONT_WIDGET" }
        });
      }

      const intent = await effectiveIntentEngine.classify({ message, session });
      session = await applyIntentToCommerceSession(context, session, intent);
      await safeEvent(context, logger, {
        eventType: "intent_captured",
        conversationId: session.conversationId,
        commerceSessionId: session.id,
        payload: { goal: intent.goal, confidence: intent.confidence }
      });

      if (intent.missingInformation.length > 0) {
        await safeEvent(context, logger, {
          eventType: "clarification_requested",
          conversationId: session.conversationId,
          commerceSessionId: session.id,
          payload: { fields: intent.missingInformation }
        });
      }

      const merchantConfig = await getMerchantConfig(context);
      const accountUrls = await safeResolveCustomerUrls(context, session.conversationId, logger);
      const mcpClient = new MCPClient({
        context,
        customerMcpEndpoint: accountUrls?.mcpApiUrl
      });
      await mcpClient.initialize();

      const checkoutAdapter = createCheckoutAdapter({
        shopDomain: context.shopDomain,
        storefrontOrigin: context.storefrontOrigin
      });
      const registry = createToolRegistry({
        catalogAdapter: createCatalogAdapter(mcpClient),
        policyAdapter: createPolicyAdapter(mcpClient),
        cartAdapter: createCartAdapter(mcpClient),
        checkoutAdapter,
        knowledgeService
      });
      const products = [];
      let cartState = null;
      let confirmationRequired = null;
      const confirmation = resolveConfirmation(message, session.pendingMessages);
      const confirmationRejected = resolveConfirmationRejection(message, session.pendingMessages);

      if (confirmation) {
        await safeEvent(context, logger, {
          eventType: "cart_confirmation_accepted",
          conversationId: session.conversationId,
          commerceSessionId: session.id,
          payload: {
            productId: confirmation.productId,
            variantId: confirmation.variantId,
            quantity: confirmation.quantity
          }
        });
      } else if (confirmationRejected) {
        session = await updateCommerceSession(context, session.id, {
          journeyStage: "COMPARE",
          pendingMessages: session.pendingMessages.filter((item) => item?.type !== "cart_confirmation")
        }, session.version);
        await safeEvent(context, logger, {
          eventType: "cart_confirmation_rejected",
          conversationId: session.conversationId,
          commerceSessionId: session.id,
          payload: {}
        });
      }

      const executeTool = async (name, input) => {
        stream?.sendMessage({ type: "tool_use", tool_use_message: `Calling tool: ${name}` });
        await safeEvent(context, logger, {
          eventType: "tool_called",
          conversationId: session.conversationId,
          commerceSessionId: session.id,
          payload: { tool: name }
        });

        try {
          const result = await registry.execute(name, input, {
            context,
            session,
            confirmation
          });
          if (result.sessionPatch) {
            session = await updateCommerceSession(
              context,
              session.id,
              result.sessionPatch,
              session.version
            );
          }

          if (result.type === "catalog") products.push(...(result.products || []));
          if (result.type === "confirmation_required") confirmationRequired = result.data;
          if (result.type === "cart_updated" || result.type === "checkout_handoff") {
            cartState = {
              cartId: session.cartId,
              checkoutUrl: session.checkoutUrl
            };
          }
          await recordResultEvent(context, logger, session, name, result);
          return result;
        } catch (error) {
          if (error.code === "AUTH_REQUIRED") {
            stream?.sendMessage({
              type: "auth_required",
              authorization_url: error.authorizationUrl
            });
          }
          await safeEvent(context, logger, {
            eventType: "tool_failed",
            conversationId: session.conversationId,
            commerceSessionId: session.id,
            payload: { tool: name, code: error.code || "TOOL_FAILED" }
          });
          throw error;
        }
      };

      let llmResult;
      try {
        llmResult = await gateway.runToolLoop({
          messages: session.messages,
          promptType,
          merchantConfig,
          commerceContext: getCommerceContext(session),
          tools: registry.listModelTools(),
          executeTool,
          onText: (chunk) => stream?.sendMessage({ type: "chunk", chunk })
        });
      } catch (error) {
        await safeEvent(context, logger, {
          eventType: "llm_failed",
          conversationId: session.conversationId,
          commerceSessionId: session.id,
          payload: { code: error.code || "LLM_FAILED" }
        });
        throw error;
      }

      const assistantText = llmResult.text.trim() || fallbackAssistantText({
        confirmationRequired,
        products
      });
      if (!llmResult.text.trim()) {
        stream?.sendMessage({ type: "chunk", chunk: assistantText });
      }
      await appendAssistantMessage(context, session, {
        content: assistantText,
        structuredContent: {
          products: uniqueProducts(products),
          confirmationRequired,
          cartState
        },
        toolCalls: llmResult.toolCalls,
        toolResults: llmResult.toolResults,
        model: llmResult.model,
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens,
        latencyMs: llmResult.latencyMs
      });

      stream?.sendMessage({ type: "message_complete" });
      if (products.length > 0) {
        stream?.sendMessage({ type: "product_results", products: uniqueProducts(products) });
      }
      if (cartState) stream?.sendMessage({ type: "cart_state", ...cartState });
      stream?.sendMessage({ type: "end_turn" });

      logger.info("Commerce turn completed", {
        journeyStage: session.journeyStage,
        intent: intent.goal,
        toolCount: llmResult.toolCalls.length,
        durationMs: Date.now() - startedAt,
        status: "ok",
        provider: gateway.provider,
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens
      });

      return {
        text: assistantText,
        conversationId: session.conversationId,
        commerceSession: session,
        products: uniqueProducts(products),
        confirmationRequired,
        cartState,
        intent
      };
    }
  };
}

async function safeResolveCustomerUrls(context, conversationId, logger) {
  try {
    return await resolveCustomerAccountUrls(context, conversationId);
  } catch (error) {
    logger.warn("Customer account discovery unavailable", { error });
    return null;
  }
}

async function safeEvent(context, logger, event) {
  try {
    await recordCommerceEvent(context, event);
  } catch (error) {
    logger.warn("Commerce event could not be recorded", {
      eventType: event.eventType,
      error
    });
  }
}

async function recordResultEvent(context, logger, session, toolName, result) {
  const byResult = {
    catalog: result.products?.length ? "products_recommended" : "catalog_search_empty",
    comparison: "comparison_requested",
    knowledge: "knowledge_retrieved",
    confirmation_required: "cart_confirmation_requested",
    cart_updated: "cart_updated",
    checkout_handoff: "checkout_opened"
  };
  const eventType = byResult[result.type];
  if (!eventType) return;
  if (result.type === "catalog") {
    await safeEvent(context, logger, {
      eventType: "catalog_searched",
      conversationId: session.conversationId,
      commerceSessionId: session.id,
      payload: { tool: toolName }
    });
  }
  await safeEvent(context, logger, {
    eventType,
    conversationId: session.conversationId,
    commerceSessionId: session.id,
    payload: {
      tool: toolName,
      resultCount: Array.isArray(result.data) ? result.data.length : undefined
    }
  });
}

export function resolveConfirmation(message, pendingMessages = []) {
  const pending = [...pendingMessages]
    .reverse()
    .find((item) => item?.type === "cart_confirmation");
  if (!pending || !isExplicitConfirmation(message)) return null;
  return {
    accepted: true,
    productId: pending.productId,
    variantId: pending.variantId,
    quantity: pending.quantity
  };
}

export function isExplicitConfirmation(message) {
  const normalized = String(message || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .trim();
  return /^(yes|yes please|i confirm|confirmed|confirm it|go ahead|add it|oui|oui merci|je confirme|vas-y|sí|si|confirmo|añádelo)[.!\s]*$/u.test(normalized);
}

export function resolveConfirmationRejection(message, pendingMessages = []) {
  const hasPending = pendingMessages.some((item) => item?.type === "cart_confirmation");
  return hasPending && isExplicitRejection(message);
}

export function isExplicitRejection(message) {
  const normalized = String(message || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .trim();
  return /^(no|no thanks|cancel|do not add it|non|non merci|annule|n'ajoute pas|no gracias|cancela)[.!\s]*$/u.test(normalized);
}

function uniqueProducts(products) {
  return [...new Map(products.map((product) => [
    String(product.productId || product.product_id || product.id),
    product
  ])).values()].filter((product) => product.id || product.productId || product.product_id).slice(0, 3);
}

function fallbackAssistantText({ confirmationRequired, products }) {
  if (confirmationRequired) {
    return "Please confirm the exact product, variant, and quantity before I update your cart.";
  }
  if (products.length > 0) return "I found a short list of matching products.";
  return "I could not complete that request right now. Please try again.";
}
