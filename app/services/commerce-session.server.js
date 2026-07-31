import prisma from "../db.server";
import { JourneyStageSchema, ShoppingIntentSchema } from "../contracts/commerce.schemas.server";

const DEFAULT_TTL_SECONDS = 30 * 60;

const ALLOWED_TRANSITIONS = {
  DISCOVER: new Set(["DISCOVER", "COMPARE", "CONFIRM", "ABANDONED", "EXPIRED"]),
  COMPARE: new Set(["DISCOVER", "COMPARE", "CONFIRM", "ABANDONED", "EXPIRED"]),
  CONFIRM: new Set(["COMPARE", "CONFIRM", "CART", "ABANDONED", "EXPIRED"]),
  CART: new Set(["CART", "CHECKOUT", "ABANDONED", "EXPIRED"]),
  CHECKOUT: new Set(["CHECKOUT", "COMPLETED", "ABANDONED", "EXPIRED"]),
  COMPLETED: new Set(["COMPLETED"]),
  ABANDONED: new Set(["ABANDONED"]),
  EXPIRED: new Set(["EXPIRED"])
};

export class CommerceSessionConflictError extends Error {
  constructor() {
    super("Commerce session was updated by another request");
    this.name = "CommerceSessionConflictError";
    this.status = 409;
  }
}

export class InvalidJourneyTransitionError extends Error {
  constructor(from, to) {
    super(`Invalid commerce journey transition: ${from} -> ${to}`);
    this.name = "InvalidJourneyTransitionError";
    this.status = 409;
  }
}

export async function getOrCreateCommerceSession(context, {
  conversationId,
  visitorId,
  channel = "STOREFRONT_WIDGET"
} = {}) {
  assertContext(context);

  return prisma.$transaction(async (tx) => {
    let resolvedConversationId = conversationId || crypto.randomUUID();
    let conversation = await tx.conversation.findFirst({
      where: { id: resolvedConversationId, shopId: context.shopId }
    });

    if (!conversation) {
      try {
        conversation = await tx.conversation.create({
          data: {
            id: resolvedConversationId,
            shopId: context.shopId,
            visitorId: visitorId || null,
            channel
          }
        });
      } catch (error) {
        if (error?.code !== "P2002") throw error;
        resolvedConversationId = crypto.randomUUID();
        conversation = await tx.conversation.create({
          data: {
            id: resolvedConversationId,
            shopId: context.shopId,
            visitorId: visitorId || null,
            channel
          }
        });
      }
    }

    let record = await tx.commerceSession.findUnique({
      where: { conversationId: conversation.id }
    });

    if (record && record.expiresAt <= new Date()) {
      await tx.commerceSession.update({
        where: { id: record.id },
        data: { journeyStage: "EXPIRED", version: { increment: 1 } }
      });
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { status: "EXPIRED", endedAt: new Date() }
      });

      resolvedConversationId = crypto.randomUUID();
      conversation = await tx.conversation.create({
        data: {
          id: resolvedConversationId,
          shopId: context.shopId,
          visitorId: visitorId || null,
          channel
        }
      });
      record = null;
    }

    if (!record) {
      record = await tx.commerceSession.create({
        data: createSessionData(context, conversation.id, visitorId)
      });
    }

    const messages = await tx.message.findMany({
      where: {
        shopId: context.shopId,
        conversationId: conversation.id
      },
      orderBy: { createdAt: "asc" }
    });

    return toDomainSession(record, messages);
  });
}

export async function getCommerceSession(context, commerceSessionId) {
  assertContext(context);
  const record = await prisma.commerceSession.findFirst({
    where: { id: commerceSessionId, shopId: context.shopId },
    include: {
      conversation: {
        include: { messages: { orderBy: { createdAt: "asc" } } }
      }
    }
  });
  if (!record) return null;
  return toDomainSession(record, record.conversation.messages);
}

export async function appendUserMessage(context, session, message) {
  return appendMessage(context, session, {
    role: "user",
    content: message
  });
}

export async function appendAssistantMessage(context, session, {
  content,
  structuredContent,
  toolCalls,
  toolResults,
  model,
  inputTokens,
  outputTokens,
  latencyMs
}) {
  return appendMessage(context, session, {
    role: "assistant",
    content,
    structuredContent,
    toolCalls,
    toolResults,
    model,
    inputTokens,
    outputTokens,
    latencyMs
  });
}

export async function updateCommerceSession(context, sessionId, changes, expectedVersion) {
  assertContext(context);
  const data = toPersistenceChanges(changes);
  const result = await prisma.commerceSession.updateMany({
    where: {
      id: sessionId,
      shopId: context.shopId,
      version: expectedVersion,
      expiresAt: { gt: new Date() }
    },
    data: {
      ...data,
      version: { increment: 1 }
    }
  });

  if (result.count !== 1) throw new CommerceSessionConflictError();
  return getCommerceSession(context, sessionId);
}

export async function applyIntentToCommerceSession(context, session, rawIntent) {
  const intent = ShoppingIntentSchema.parse(rawIntent);
  const constraints = mergeConstraints(session.constraints || {}, intent);
  const targetStage = stageForIntent(intent.goal, session.journeyStage);
  assertJourneyTransition(session.journeyStage, targetStage);

  return updateCommerceSession(context, session.id, {
    structuredIntent: intent,
    constraints,
    journeyStage: targetStage
  }, session.version);
}

export async function transitionJourneyStage(context, session, nextStage, changes = {}) {
  const parsedStage = JourneyStageSchema.parse(nextStage);
  assertJourneyTransition(session.journeyStage, parsedStage);
  return updateCommerceSession(context, session.id, {
    ...changes,
    journeyStage: parsedStage
  }, session.version);
}

export async function expireCommerceSession(context, session) {
  return transitionJourneyStage(context, session, "EXPIRED");
}

export async function abandonCommerceSession(context, session) {
  return transitionJourneyStage(context, session, "ABANDONED");
}

export async function completeCommerceSession(context, session) {
  return transitionJourneyStage(context, session, "COMPLETED");
}

export async function expireStaleCommerceSessions(now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const stale = await tx.commerceSession.findMany({
      where: {
        expiresAt: { lte: now },
        journeyStage: { notIn: ["COMPLETED", "ABANDONED", "EXPIRED"] }
      },
      select: { id: true, conversationId: true }
    });
    if (stale.length === 0) return { count: 0 };

    const ids = stale.map((item) => item.id);
    const conversationIds = stale.map((item) => item.conversationId);
    await tx.commerceSession.updateMany({
      where: { id: { in: ids } },
      data: { journeyStage: "EXPIRED", version: { increment: 1 } }
    });
    await tx.conversation.updateMany({
      where: { id: { in: conversationIds } },
      data: { status: "EXPIRED", endedAt: now }
    });
    return { count: stale.length };
  });
}

export function getCommerceContext(session) {
  return {
    journeyStage: session.journeyStage,
    intent: session.structuredIntent,
    constraints: session.constraints,
    catalogResults: session.recommendedProducts,
    comparedProducts: session.comparedProducts,
    selectedProductId: session.selectedProductId,
    selectedVariantId: session.selectedVariantId,
    quantity: session.quantity,
    cartId: session.cartId,
    buyerContext: session.buyerContext,
    pendingBusinessMessages: session.pendingMessages
  };
}

export function assertJourneyTransition(from, to) {
  if (!ALLOWED_TRANSITIONS[from]?.has(to)) {
    throw new InvalidJourneyTransitionError(from, to);
  }
}

export function mergeConstraints(previous, intent) {
  const next = { ...previous };
  if (intent.category !== null) next.category = intent.category;
  if (intent.useCase !== null) next.useCase = intent.useCase;

  next.budget = {
    ...(previous.budget || {}),
    ...(intent.budget.min !== null ? { min: intent.budget.min } : {}),
    ...(intent.budget.max !== null ? { max: intent.budget.max } : {}),
    ...(intent.budget.currency !== null ? { currency: intent.budget.currency } : {})
  };
  next.attributes = { ...(previous.attributes || {}), ...intent.attributes };
  next.preferences = unique([...(previous.preferences || []), ...intent.preferences]);
  next.exclusions = unique([...(previous.exclusions || []), ...intent.exclusions]);
  return next;
}

function appendMessage(context, session, data) {
  assertContext(context);
  return prisma.message.create({
    data: {
      shopId: context.shopId,
      conversationId: session.conversationId,
      ...data
    }
  });
}

function createSessionData(context, conversationId, visitorId) {
  const ttlSeconds = Math.max(
    Number(process.env.COMMERCE_SESSION_TTL_SECONDS || DEFAULT_TTL_SECONDS),
    300
  );
  return {
    shopId: context.shopId,
    conversationId,
    visitorId: visitorId || null,
    constraints: {},
    recommendedProducts: [],
    comparedProducts: [],
    buyerContext: {},
    pendingMessages: [],
    expiresAt: new Date(Date.now() + ttlSeconds * 1000)
  };
}

function toPersistenceChanges(changes) {
  const allowed = [
    "journeyStage", "structuredIntent", "constraints", "recommendedProducts",
    "comparedProducts", "selectedProductId", "selectedVariantId", "quantity",
    "cartId", "checkoutUrl", "buyerContext", "pendingMessages", "expiresAt",
    "customerId", "visitorId"
  ];
  return Object.fromEntries(
    Object.entries(changes).filter(([key, value]) =>
      allowed.includes(key) && value !== undefined
    )
  );
}

function toDomainSession(record, messages = []) {
  return {
    id: record.id,
    commerceSessionId: record.id,
    conversationId: record.conversationId,
    sessionId: record.conversationId,
    journeyStage: record.journeyStage,
    structuredIntent: record.structuredIntent,
    intent: record.structuredIntent,
    constraints: record.constraints || {},
    recommendedProducts: record.recommendedProducts || [],
    catalogResults: record.recommendedProducts || [],
    comparedProducts: record.comparedProducts || [],
    selectedProductId: record.selectedProductId,
    selectedVariantId: record.selectedVariantId,
    quantity: record.quantity,
    cartId: record.cartId,
    checkoutUrl: record.checkoutUrl,
    buyerContext: record.buyerContext || {},
    pendingMessages: record.pendingMessages || [],
    pendingBusinessMessages: record.pendingMessages || [],
    version: record.version,
    expiresAt: record.expiresAt,
    messages: formatMessages(messages)
  };
}

function formatMessages(messages) {
  return messages.map((message) => {
    let content = message.content;
    try {
      content = JSON.parse(message.content);
    } catch (_error) {
      // Plain text is a valid stored message format.
    }
    return { role: message.role, content };
  });
}

function stageForIntent(goal, currentStage) {
  const mapping = {
    discover: "DISCOVER",
    compare: "COMPARE",
    product_question: currentStage,
    policy_question: currentStage,
    select_product: "CONFIRM",
    select_variant: "CONFIRM",
    // A cart intent only identifies the requested action. The registry moves
    // the session to CART after the exact variant and quantity are confirmed
    // and Shopify accepts the mutation.
    update_cart: "CONFIRM",
    checkout: currentStage === "CART" ? "CHECKOUT" : currentStage,
    support: currentStage,
    unknown: currentStage
  };
  return mapping[goal] || currentStage;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function assertContext(context) {
  if (!context?.shopId) throw new Error("Merchant context is required");
}
