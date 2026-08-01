import { createLogger } from "../lib/logger.server";
import { getMerchantConfig } from "../merchant/merchant.server";
import { withConversationContext } from "../security/merchant-context.server";
import {
  appendAssistantMessage,
  appendUserMessage,
  applyIntentToCommerceSession,
  getCommerceContext,
  getOrCreateCommerceSession,
  updateCommerceSession,
} from "./commerce-session.server";
import { createIntentEngine } from "./intent-router.server";
import { createLLMGateway } from "./llm-gateway.server";
import { createKnowledgeService } from "./knowledge.server";
import { createToolRegistry } from "./tool-registry.server";
import { recordCommerceEvent } from "./analytics-event.server";
import { createCommerceProvider } from "./commerce/provider-registry.server";
import {
  createCommerceMutationCoordinator,
  createTurnSideEffectState,
} from "./commerce-mutation.server";
import {
  getOrCreateExperimentAssignment,
  LAUNCHER_ENTRY_EXPERIMENT,
  recordExperimentExposure,
} from "./experiment.server";
import { markRecoveryRestored } from "./recovery.server";
import { buildExperienceDocument } from "./experience-document.server";

export function createCommerceOrchestrator({
  intentEngine,
  llmGateway,
  knowledgeService = createKnowledgeService(),
  commerceProviderFactory = createCommerceProvider,
} = {}) {
  return {
    async handleTurn({
      context: baseContext,
      message,
      conversationId,
      visitorId,
      promptType,
      stream,
    }) {
      const startedAt = Date.now();
      const merchantConfig = await getMerchantConfig(baseContext);
      const gateway =
        llmGateway ||
        createLLMGateway({
          provider:
            merchantConfig.assistant.providerPreference === "auto"
              ? undefined
              : merchantConfig.assistant.providerPreference,
        });
      const effectiveIntentEngine =
        intentEngine || createIntentEngine({ llmGateway: gateway });
      const recoveryEnabled = Boolean(
        merchantConfig.shopping.recovery.enabled &&
        merchantConfig.shopping.featureFlags.sessionRecovery,
      );
      let session = await getOrCreateCommerceSession(baseContext, {
        conversationId,
        visitorId,
        allowRecovery: recoveryEnabled,
        ttlSeconds: recoveryEnabled
          ? merchantConfig.shopping.recovery.ttlHours * 60 * 60
          : undefined,
      });
      let context = withConversationContext(
        baseContext,
        session.conversationId,
      );
      const launcherExperiment = merchantConfig.experiments.launcherEntry;
      const experimentAssignment = await getOrCreateExperimentAssignment(
        context,
        {
          visitorId: session.visitorId || visitorId,
          experimentKey: LAUNCHER_ENTRY_EXPERIMENT,
          enabled: launcherExperiment.enabled,
          killSwitch: merchantConfig.experiments.killSwitch,
          treatmentPercentage: launcherExperiment.treatmentPercentage,
        },
      );
      if (
        experimentAssignment &&
        session.experimentAssignmentId !== experimentAssignment.id
      ) {
        session = await updateCommerceSession(
          context,
          session.id,
          { experimentAssignmentId: experimentAssignment.id },
          session.version,
        );
      }
      if (experimentAssignment) {
        context = Object.freeze({
          ...context,
          experimentKey: experimentAssignment.experimentKey,
          experimentVariant: experimentAssignment.variant,
        });
      }
      const logger = createLogger({
        requestId: context.requestId,
        shopId: context.shopId,
        conversationId: session.conversationId,
        commerceSessionId: session.id,
      });
      const isNewConversation = session.messages.length === 0;

      if (session.wasRecovered && session.recoveryState) {
        await safeEvent(context, logger, {
          eventType: "recovery_restored",
          conversationId: session.conversationId,
          commerceSessionId: session.id,
          payload: {
            recoveryVersion: session.recoveryState.version,
            restoredAt: new Date().toISOString(),
          },
        });
        session = {
          ...session,
          recoveryState: markRecoveryRestored(session.recoveryState),
        };
      }

      if (experimentAssignment) {
        try {
          await recordExperimentExposure(context, experimentAssignment, {
            conversationId: session.conversationId,
            commerceSessionId: session.id,
          });
        } catch (error) {
          logger.warn("Experiment exposure could not be recorded", { error });
        }
      }

      stream?.sendMessage({
        type: "id",
        conversation_id: session.conversationId,
      });
      await appendUserMessage(context, session, message);
      session = {
        ...session,
        messages: [...session.messages, { role: "user", content: message }],
      };
      await safeEvent(context, logger, {
        eventType: "message_sent",
        conversationId: session.conversationId,
        commerceSessionId: session.id,
        payload: { channel: "STOREFRONT_WIDGET" },
      });
      if (isNewConversation) {
        await safeEvent(context, logger, {
          eventType: "conversation_started",
          conversationId: session.conversationId,
          commerceSessionId: session.id,
          payload: { channel: "STOREFRONT_WIDGET" },
        });
      }

      const intent = await effectiveIntentEngine.classify({ message, session });
      session = await applyIntentToCommerceSession(context, session, intent);
      await safeEvent(context, logger, {
        eventType: "intent_captured",
        conversationId: session.conversationId,
        commerceSessionId: session.id,
        payload: { goal: intent.goal, confidence: intent.confidence },
      });

      if (intent.missingInformation.length > 0) {
        await safeEvent(context, logger, {
          eventType: "clarification_requested",
          conversationId: session.conversationId,
          commerceSessionId: session.id,
          payload: { fields: intent.missingInformation },
        });
      }

      const commerceProvider = commerceProviderFactory({
        context,
        merchantConfig,
      });
      const commerceDiscovery = await commerceProvider.initialize();
      await safeEvent(context, logger, {
        eventType: "commerce_provider_initialized",
        conversationId: session.conversationId,
        commerceSessionId: session.id,
        payload: {
          provider: commerceProvider.id,
          capabilities: commerceDiscovery.capabilities,
        },
      });

      const sideEffectState = createTurnSideEffectState();
      const registry = createToolRegistry({
        commerceProvider,
        knowledgeService,
        mutationCoordinator: createCommerceMutationCoordinator(),
      });
      const products = [];
      let cartState = null;
      let confirmationRequired = null;
      const confirmation = resolveConfirmation(
        message,
        session.pendingMessages,
      );
      const confirmationRejected = resolveConfirmationRejection(
        message,
        session.pendingMessages,
      );

      if (confirmation) {
        await safeEvent(context, logger, {
          eventType: "cart_confirmation_accepted",
          conversationId: session.conversationId,
          commerceSessionId: session.id,
          payload: {
            productId: confirmation.productId,
            variantId: confirmation.variantId,
            quantity: confirmation.quantity,
          },
        });
      } else if (confirmationRejected) {
        session = await updateCommerceSession(
          context,
          session.id,
          {
            journeyStage: "COMPARE",
            pendingMessages: session.pendingMessages.filter(
              (item) => item?.type !== "cart_confirmation",
            ),
          },
          session.version,
        );
        await safeEvent(context, logger, {
          eventType: "cart_confirmation_rejected",
          conversationId: session.conversationId,
          commerceSessionId: session.id,
          payload: {},
        });
      }

      const executeTool = async (name, input) => {
        stream?.sendMessage({
          type: "tool_use",
          tool_use_message: `Calling tool: ${name}`,
        });
        await safeEvent(context, logger, {
          eventType: "tool_called",
          conversationId: session.conversationId,
          commerceSessionId: session.id,
          payload: { tool: name },
        });

        try {
          const result = await registry.execute(name, input, {
            context,
            session,
            confirmation,
            sideEffectState,
          });
          if (result.sessionPatch) {
            session = await updateCommerceSession(
              context,
              session.id,
              result.sessionPatch,
              session.version,
            );
          }

          if (result.type === "catalog")
            products.push(...(result.products || []));
          if (result.type === "confirmation_required")
            confirmationRequired = result.data;
          if (
            result.type === "cart_updated" ||
            result.type === "checkout_handoff"
          ) {
            cartState = {
              cartId: session.cartId,
              checkoutUrl: session.checkoutUrl,
            };
          }
          await recordResultEvent(context, logger, session, name, result);
          return result;
        } catch (error) {
          if (error.code === "AUTH_REQUIRED") {
            stream?.sendMessage({
              type: "auth_required",
              authorization_url: error.authorizationUrl,
            });
          }
          await safeEvent(context, logger, {
            eventType: "tool_failed",
            conversationId: session.conversationId,
            commerceSessionId: session.id,
            payload: { tool: name, code: error.code || "TOOL_FAILED" },
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
          commerceContext: {
            ...getCommerceContext(session),
            experiment: experimentAssignment,
          },
          tools: registry.listModelTools(),
          executeTool,
          sideEffectState,
          onText: (chunk) => stream?.sendMessage({ type: "chunk", chunk }),
        });
      } catch (error) {
        await safeEvent(context, logger, {
          eventType: "llm_failed",
          conversationId: session.conversationId,
          commerceSessionId: session.id,
          payload: { code: error.code || "LLM_FAILED" },
        });
        throw error;
      }

      const assistantText =
        llmResult.text.trim() ||
        fallbackAssistantText({
          confirmationRequired,
          products,
        });
      if (!llmResult.text.trim()) {
        stream?.sendMessage({ type: "chunk", chunk: assistantText });
      }
      const turnProducts = uniqueProducts(products);
      const { document: experienceDocument, recommendations } =
        buildExperienceDocument({
          context,
          merchantConfig,
          session,
          intent,
          assistantText,
          products: turnProducts,
          confirmationRequired,
          cartState,
          providerId: commerceProvider.id,
        });
      await appendAssistantMessage(context, session, {
        content: assistantText,
        structuredContent: {
          products: turnProducts,
          recommendations,
          confirmationRequired,
          cartState,
          experienceDocument,
        },
        toolCalls: llmResult.toolCalls,
        toolResults: llmResult.toolResults,
        model: llmResult.model,
        provider: llmResult.provider,
        costMicros: llmResult.costMicros,
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens,
        latencyMs: llmResult.latencyMs,
      });

      if (recoveryEnabled && session.recoveryState) {
        await safeEvent(context, logger, {
          eventType: "recovery_saved",
          conversationId: session.conversationId,
          commerceSessionId: session.id,
          payload: {
            journeyStage: session.journeyStage,
            hasRecommendations: session.recommendedProducts.length > 0,
            hasCartCandidate: Boolean(
              session.selectedProductId && session.selectedVariantId,
            ),
          },
        });
      }

      stream?.sendMessage({ type: "message_complete" });
      stream?.sendMessage({
        type: "experience_document",
        document: experienceDocument,
      });
      if (turnProducts.length > 0) {
        stream?.sendMessage({
          type: "product_results",
          products: turnProducts,
        });
      }
      if (cartState) stream?.sendMessage({ type: "cart_state", ...cartState });
      stream?.sendMessage({ type: "end_turn" });

      logger.info("Commerce turn completed", {
        journeyStage: session.journeyStage,
        intent: intent.goal,
        toolCount: llmResult.toolCalls.length,
        durationMs: Date.now() - startedAt,
        status: "ok",
        provider: llmResult.provider,
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens,
        costMicros: llmResult.costMicros,
      });

      return {
        text: assistantText,
        conversationId: session.conversationId,
        commerceSession: session,
        products: turnProducts,
        experienceDocument,
        confirmationRequired,
        cartState,
        intent,
      };
    },
  };
}

async function safeEvent(context, logger, event) {
  try {
    await recordCommerceEvent(context, event);
  } catch (error) {
    logger.warn("Commerce event could not be recorded", {
      eventType: event.eventType,
      error,
    });
  }
}

async function recordResultEvent(context, logger, session, toolName, result) {
  const byResult = {
    catalog: result.products?.length
      ? "products_recommended"
      : "catalog_search_empty",
    comparison: "comparison_requested",
    knowledge: "knowledge_retrieved",
    confirmation_required: "cart_confirmation_requested",
    cart_updated: "cart_updated",
    checkout_handoff: "checkout_opened",
  };
  const eventType = byResult[result.type];
  if (!eventType) return;
  if (result.type === "catalog") {
    await safeEvent(context, logger, {
      eventType: "catalog_searched",
      conversationId: session.conversationId,
      commerceSessionId: session.id,
      payload: { tool: toolName },
    });
  }
  await safeEvent(context, logger, {
    eventType,
    conversationId: session.conversationId,
    commerceSessionId: session.id,
    payload: {
      tool: toolName,
      resultCount: Array.isArray(result.data) ? result.data.length : undefined,
    },
  });
  if (result.type === "checkout_handoff" && result.provider === "ucp") {
    await safeEvent(context, logger, {
      eventType: "ucp_handoff",
      conversationId: session.conversationId,
      commerceSessionId: session.id,
      payload: {
        requiresEscalation: Boolean(result.requiresEscalation),
        warningCount: result.warnings?.length || 0,
        disclosureCount: result.disclosures?.length || 0,
      },
    });
  }
}

export function resolveConfirmation(message, pendingMessages = []) {
  const pending = [...pendingMessages]
    .reverse()
    .find((item) => item?.type === "cart_confirmation");
  if (!pending || !isExplicitConfirmation(message)) return null;
  return {
    accepted: true,
    confirmationId: pending.confirmationId,
    selectionRevision: pending.selectionRevision,
    productId: pending.productId,
    variantId: pending.variantId,
    quantity: pending.quantity,
  };
}

export function isExplicitConfirmation(message) {
  const normalized = String(message || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .trim();
  return /^(yes|yes please|i confirm|confirmed|confirm it|go ahead|add it|oui|oui merci|je confirme|vas-y|sí|si|confirmo|añádelo)[.!\s]*$/u.test(
    normalized,
  );
}

export function resolveConfirmationRejection(message, pendingMessages = []) {
  const hasPending = pendingMessages.some(
    (item) => item?.type === "cart_confirmation",
  );
  return hasPending && isExplicitRejection(message);
}

export function isExplicitRejection(message) {
  const normalized = String(message || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .trim();
  return /^(no|no thanks|cancel|do not add it|non|non merci|annule|n'ajoute pas|no gracias|cancela)[.!\s]*$/u.test(
    normalized,
  );
}

function uniqueProducts(products) {
  return [
    ...new Map(
      products.map((product) => [
        String(product.productId || product.product_id || product.id),
        product,
      ]),
    ).values(),
  ]
    .filter((product) => product.id || product.productId || product.product_id)
    .slice(0, 3);
}

function fallbackAssistantText({ confirmationRequired, products }) {
  if (confirmationRequired) {
    return "Please confirm the exact product, variant, and quantity before I update your cart.";
  }
  if (products.length > 0) return "I found a short list of matching products.";
  return "I could not complete that request right now. Please try again.";
}
