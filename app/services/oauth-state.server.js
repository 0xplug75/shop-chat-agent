import { createHash, randomBytes } from "node:crypto";
import prisma from "../db.server";
import { decryptSecret, encryptSecret } from "../security/encryption.server";

export class OAuthStateError extends Error {
  constructor(message = "OAuth state is invalid or expired") {
    super(message);
    this.name = "OAuthStateError";
    this.status = 400;
  }
}

export async function createOAuthState(context, {
  conversationId,
  codeVerifier,
  redirectUri,
  ttlSeconds = Number(process.env.OAUTH_STATE_TTL_SECONDS || 600)
}) {
  if (!context?.shopId) throw new OAuthStateError();
  if (conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, shopId: context.shopId },
      select: { id: true }
    });
    if (!conversation) throw new OAuthStateError();
  }
  const state = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + Math.min(Math.max(ttlSeconds, 60), 900) * 1000);

  await prisma.oAuthState.create({
    data: {
      stateHash: hashState(state),
      shopId: context.shopId,
      conversationId: conversationId || null,
      encryptedCodeVerifier: codeVerifier ? encryptSecret(codeVerifier) : null,
      redirectUri: redirectUri || null,
      expiresAt
    }
  });

  return { state, expiresAt };
}

export async function consumeOAuthState(state, { expectedShopId } = {}) {
  if (typeof state !== "string" || state.length < 32 || state.length > 512) {
    throw new OAuthStateError();
  }

  return prisma.$transaction(async (tx) => {
    const record = await tx.oAuthState.findUnique({
      where: { stateHash: hashState(state) },
      include: { shop: true }
    });

    if (
      !record ||
      record.consumedAt ||
      record.expiresAt <= new Date() ||
      (expectedShopId && record.shopId !== expectedShopId)
    ) {
      throw new OAuthStateError();
    }

    const consumed = await tx.oAuthState.updateMany({
      where: {
        id: record.id,
        consumedAt: null,
        expiresAt: { gt: new Date() }
      },
      data: { consumedAt: new Date() }
    });
    if (consumed.count !== 1) throw new OAuthStateError();

    return {
      ...record,
      codeVerifier: record.encryptedCodeVerifier
        ? decryptSecret(record.encryptedCodeVerifier)
        : null
    };
  });
}

export async function deleteExpiredOAuthStates(now = new Date()) {
  return prisma.oAuthState.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        { consumedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } }
      ]
    }
  });
}

function hashState(state) {
  return createHash("sha256").update(state).digest("hex");
}
