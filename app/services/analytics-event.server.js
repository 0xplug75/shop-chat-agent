import prisma from "../db.server";

const ALLOWED_EVENT_TYPES = new Set([
  "widget_opened", "widget_closed", "conversation_started", "message_sent",
  "intent_captured", "clarification_requested", "catalog_searched",
  "catalog_search_empty", "products_recommended", "recommendation_refined",
  "comparison_requested", "product_selected", "variant_selected",
  "cart_confirmation_requested", "cart_confirmation_accepted",
  "cart_confirmation_rejected", "cart_updated", "checkout_opened",
  "purchase_completed", "journey_abandoned", "knowledge_retrieved",
  "tool_called", "tool_failed", "llm_failed"
]);

export async function recordCommerceEvent(context, {
  eventType,
  conversationId,
  commerceSessionId,
  payload = {}
}) {
  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    throw new Error(`Unsupported commerce event: ${eventType}`);
  }

  return prisma.commerceEvent.create({
    data: {
      shopId: context.shopId,
      conversationId: conversationId || null,
      commerceSessionId: commerceSessionId || null,
      eventType,
      payload: sanitizePayload(payload),
      requestId: context.requestId
    }
  });
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

  const forbidden = /(token|secret|authorization|cookie|payment|checkoutUrl|email|phone|address)/i;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !forbidden.test(key))
      .slice(0, 50)
      .map(([key, item]) => [key, sanitizeValue(item, depth + 1)])
  );
}
