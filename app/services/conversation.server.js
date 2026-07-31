import prisma from "../db.server";

export class ConversationNotFoundError extends Error {
  constructor() {
    super("Conversation not found");
    this.name = "ConversationNotFoundError";
    this.status = 404;
  }
}
export async function getConversationHistory(context, conversationId) {
  assertContext(context);
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, shopId: context.shopId },
    select: { id: true }
  });
  if (!conversation) throw new ConversationNotFoundError();

  return prisma.message.findMany({
    where: { shopId: context.shopId, conversationId },
    orderBy: { createdAt: "asc" }
  });
}

export async function saveConversationMessage(context, {
  conversationId,
  role,
  content,
  structuredContent,
  toolCalls,
  toolResults,
  model,
  inputTokens,
  outputTokens,
  latencyMs
}) {
  assertContext(context);
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, shopId: context.shopId },
    select: { id: true }
  });
  if (!conversation) throw new ConversationNotFoundError();

  return prisma.message.create({
    data: {
      shopId: context.shopId,
      conversationId,
      role,
      content,
      structuredContent,
      toolCalls,
      toolResults,
      model,
      inputTokens,
      outputTokens,
      latencyMs
    }
  });
}

function assertContext(context) {
  if (!context?.shopId) throw new Error("Merchant context is required");
}
