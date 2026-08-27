import prisma from "../db.server";
import { BehaviorSignalSchema } from "../contracts/commerce.schemas.server";

const ALLOWED_EVENT_TYPES = new Set([
  "widget_opened",
  "widget_closed",
  "conversation_started",
  "message_sent",
  "intent_captured",
  "clarification_requested",
  "catalog_searched",
  "catalog_search_empty",
  "products_recommended",
  "recommendation_refined",
  "comparison_requested",
  "product_selected",
  "variant_selected",
  "cart_confirmation_requested",
  "cart_confirmation_accepted",
  "cart_confirmation_rejected",
  "cart_updated",
  "checkout_opened",
  "purchase_completed",
  "journey_abandoned",
  "knowledge_retrieved",
  "tool_called",
  "tool_failed",
  "llm_failed",
  "commerce_provider_initialized",
  "commerce_outcome",
  "sage_decision_projected",
  "sage_experience_action",
  "sage_commerce_prepared",
  "sage_commerce_outcome",
  "ucp_handoff",
  "experiment_exposed",
  "recovery_saved",
  "recovery_restored",
  "recovery_expired",
]);

export async function recordCommerceEvent(
  context,
  { eventType, conversationId, commerceSessionId, payload = {}, occurredAt },
) {
  return prisma.commerceEvent.create({
    data: buildCommerceEventData(context, {
      eventType,
      conversationId,
      commerceSessionId,
      payload,
      occurredAt,
    }),
  });
}

export function buildCommerceEventData(
  context,
  {
    eventType,
    conversationId,
    commerceSessionId,
    payload = {},
    occurredAt = new Date(),
  },
) {
  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    throw new Error(`Unsupported commerce event: ${eventType}`);
  }

  const signal = BehaviorSignalSchema.parse({
    version: "1.0",
    eventName: eventType,
    shopId: context.shopId,
    visitorId: context.visitorId || null,
    conversationId: conversationId || null,
    experimentKey: context.experimentKey || null,
    variant: context.experimentVariant || null,
    payload: sanitizePayload(payload),
    occurredAt:
      occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt,
  });

  return {
    shopId: signal.shopId,
    conversationId: signal.conversationId,
    commerceSessionId: commerceSessionId || null,
    eventType: signal.eventName,
    payload: signal.payload,
    schemaVersion: signal.version,
    experimentKey: signal.experimentKey,
    experimentVariant: signal.variant,
    requestId: context.requestId,
  };
}

function sanitizePayload(payload) {
  return sanitizeValue(payload || {});
}

function sanitizeValue(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === "string") return value.slice(0, 1000);
  if (typeof value !== "object") return value;

  const forbidden =
    /(token|secret|authorization|cookie|payment|checkoutUrl|email|phone|address)/i;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !forbidden.test(key))
      .slice(0, 50)
      .map(([key, item]) => [key, sanitizeValue(item, depth + 1)]),
  );
}
