import prisma from "../db.server";
import { decryptSecret, encryptSecret } from "../security/encryption.server";

export async function storeCustomerToken(context, {
  conversationId,
  customerReference,
  accessToken,
  refreshToken,
  expiresAt
}) {
  if (!context?.shopId) throw new Error("Merchant context is required");
  if (conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, shopId: context.shopId },
      select: { id: true }
    });
    if (!conversation) throw new Error("Conversation not found");
  }

  return prisma.customerToken.upsert({
    where: {
      shopId_customerReference: {
        shopId: context.shopId,
        customerReference
      }
    },
    create: {
      shopId: context.shopId,
      conversationId: conversationId || null,
      customerReference,
      encryptedAccessToken: encryptSecret(accessToken),
      encryptedRefreshToken: refreshToken ? encryptSecret(refreshToken) : null,
      expiresAt
    },
    update: {
      conversationId: conversationId || null,
      encryptedAccessToken: encryptSecret(accessToken),
      encryptedRefreshToken: refreshToken ? encryptSecret(refreshToken) : null,
      expiresAt
    }
  });
}

export async function getCustomerToken(context, { conversationId, customerReference }) {
  if (!context?.shopId) throw new Error("Merchant context is required");
  const record = await prisma.customerToken.findFirst({
    where: {
      shopId: context.shopId,
      expiresAt: { gt: new Date() },
      ...(conversationId ? { conversationId } : {}),
      ...(customerReference ? { customerReference } : {})
    }
  });

  if (!record) return null;
  return {
    ...record,
    accessToken: decryptSecret(record.encryptedAccessToken),
    refreshToken: record.encryptedRefreshToken
      ? decryptSecret(record.encryptedRefreshToken)
      : null
  };
}

export async function revokeCustomerTokens(context, { customerReference } = {}) {
  if (!context?.shopId) throw new Error("Merchant context is required");
  return prisma.customerToken.deleteMany({
    where: {
      shopId: context.shopId,
      ...(customerReference ? { customerReference } : {})
    }
  });
}

export async function getCustomerTokenStatus(context, conversationId) {
  if (!context?.shopId) throw new Error("Merchant context is required");
  return prisma.customerToken.findFirst({
    where: {
      shopId: context.shopId,
      conversationId,
      expiresAt: { gt: new Date() }
    },
    select: { expiresAt: true }
  });
}
