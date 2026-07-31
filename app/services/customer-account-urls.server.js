import prisma from "../db.server";
import { assertTrustedShopifyUrl } from "../security/shopify-domain.server";

export async function storeCustomerAccountUrls(context, {
  conversationId,
  mcpApiUrl,
  authorizationUrl,
  tokenUrl
}) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, shopId: context.shopId },
    select: { id: true }
  });
  if (!conversation) throw new Error("Conversation not found");

  const validated = {
    mcpApiUrl: validateOptionalUrl(mcpApiUrl, context),
    authorizationUrl: validateOptionalUrl(authorizationUrl, context),
    tokenUrl: validateOptionalUrl(tokenUrl, context)
  };
  return prisma.customerAccountUrls.upsert({
    where: { conversationId },
    create: {
      shopId: context.shopId,
      conversationId,
      ...validated
    },
    update: validated
  });
}

export async function getCustomerAccountUrls(context, conversationId) {
  return prisma.customerAccountUrls.findFirst({
    where: {
      shopId: context.shopId,
      conversationId
    }
  });
}

function validateOptionalUrl(value, context) {
  return value
    ? assertTrustedShopifyUrl(value, { shopDomain: context.shopDomain }).toString()
    : null;
}
