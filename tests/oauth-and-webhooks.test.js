import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const tx = {
    oAuthState: {
      findUnique: vi.fn(),
      updateMany: vi.fn()
    },
    shop: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    },
    webhookReceipt: { create: vi.fn() },
    session: { deleteMany: vi.fn() },
    customerToken: {
      findMany: vi.fn(),
      deleteMany: vi.fn()
    },
    conversation: { deleteMany: vi.fn() },
    commerceSession: { updateMany: vi.fn() }
  };
  const prisma = {
    conversation: { findFirst: vi.fn() },
    oAuthState: {
      create: vi.fn(),
      deleteMany: vi.fn()
    },
    $transaction: vi.fn()
  };
  return { prisma, tx };
});

vi.mock("../app/db.server", () => ({ default: database.prisma }));

import {
  consumeOAuthState,
  createOAuthState,
  OAuthStateError
} from "../app/services/oauth-state.server";
import { encryptSecret } from "../app/security/encryption.server";
import { processWebhookOnce } from "../app/services/webhook.server";

const context = { shopId: "shop-alpha", shopDomain: "alpha.myshopify.com" };

describe("OAuth state and webhook lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.prisma.$transaction.mockImplementation((callback) => callback(database.tx));
    database.prisma.conversation.findFirst.mockResolvedValue({ id: "conversation-1" });
    database.prisma.oAuthState.create.mockResolvedValue({ id: "state-1" });
    database.tx.shop.findUnique.mockResolvedValue({ id: "shop-alpha" });
    database.tx.webhookReceipt.create.mockResolvedValue({ id: "receipt-1" });
    database.tx.shop.update.mockResolvedValue({ id: "shop-alpha" });
    database.tx.shop.delete.mockResolvedValue({ id: "shop-alpha" });
    database.tx.session.deleteMany.mockResolvedValue({ count: 1 });
    database.tx.customerToken.findMany.mockResolvedValue([]);
    database.tx.customerToken.deleteMany.mockResolvedValue({ count: 0 });
    database.tx.conversation.deleteMany.mockResolvedValue({ count: 0 });
    database.tx.commerceSession.updateMany.mockResolvedValue({ count: 0 });
  });

  it("stores only a hash of OAuth state and an encrypted PKCE verifier", async () => {
    const created = await createOAuthState(context, {
      conversationId: "conversation-1",
      codeVerifier: "pkce-verifier-value",
      redirectUri: "https://app.example/auth/callback"
    });

    const data = database.prisma.oAuthState.create.mock.calls[0][0].data;
    expect(data.shopId).toBe("shop-alpha");
    expect(data.stateHash).not.toBe(created.state);
    expect(data.stateHash).toHaveLength(64);
    expect(data.encryptedCodeVerifier).not.toContain("pkce-verifier-value");
    expect(database.prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: "conversation-1", shopId: "shop-alpha" },
      select: { id: true }
    });
  });

  it("consumes OAuth state atomically once and enforces the expected shop", async () => {
    const state = "s".repeat(43);
    const record = {
      id: "state-1",
      stateHash: "hash",
      shopId: "shop-alpha",
      conversationId: "conversation-1",
      encryptedCodeVerifier: encryptSecret("pkce-verifier-value"),
      redirectUri: "https://app.example/auth/callback",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      shop: { id: "shop-alpha", shopDomain: "alpha.myshopify.com" }
    };
    database.tx.oAuthState.findUnique.mockResolvedValue(record);
    database.tx.oAuthState.updateMany.mockResolvedValue({ count: 1 });

    await expect(consumeOAuthState(state, { expectedShopId: "shop-alpha" }))
      .resolves.toMatchObject({ codeVerifier: "pkce-verifier-value" });
    expect(database.tx.oAuthState.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "state-1", consumedAt: null }),
      data: { consumedAt: expect.any(Date) }
    });

    database.tx.oAuthState.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(consumeOAuthState(state, { expectedShopId: "shop-alpha" }))
      .rejects.toBeInstanceOf(OAuthStateError);
    await expect(consumeOAuthState(state, { expectedShopId: "shop-beta" }))
      .rejects.toBeInstanceOf(OAuthStateError);
  });

  it("rejects expired OAuth state without consuming it", async () => {
    database.tx.oAuthState.findUnique.mockResolvedValue({
      id: "state-expired",
      shopId: "shop-alpha",
      expiresAt: new Date(Date.now() - 1),
      consumedAt: null,
      shop: { id: "shop-alpha", shopDomain: "alpha.myshopify.com" }
    });

    await expect(consumeOAuthState("x".repeat(43), {
      expectedShopId: "shop-alpha"
    })).rejects.toBeInstanceOf(OAuthStateError);
    expect(database.tx.oAuthState.updateMany).not.toHaveBeenCalled();
  });

  it("records uninstall webhooks atomically and removes Shopify sessions", async () => {
    const result = await processWebhookOnce({
      webhookId: "webhook-1",
      topic: "APP_UNINSTALLED",
      shopDomain: "ALPHA.MYSHOPIFY.COM",
      payload: {}
    });

    expect(result).toEqual({ duplicate: false, handled: true });
    expect(database.tx.webhookReceipt.create).toHaveBeenCalledWith({
      data: {
        webhookId: "webhook-1",
        shopId: "shop-alpha",
        shopDomain: "alpha.myshopify.com",
        topic: "APP_UNINSTALLED"
      }
    });
    expect(database.tx.shop.update).toHaveBeenCalledWith({
      where: { id: "shop-alpha" },
      data: { status: "UNINSTALLED", uninstalledAt: expect.any(Date) }
    });
    expect(database.tx.session.deleteMany).toHaveBeenCalledWith({
      where: { shop: "alpha.myshopify.com" }
    });
  });

  it("treats duplicate webhook receipts as an idempotent success", async () => {
    database.prisma.$transaction.mockRejectedValueOnce({ code: "P2002" });
    await expect(processWebhookOnce({
      webhookId: "webhook-duplicate",
      topic: "APP_UNINSTALLED",
      shopDomain: "alpha.myshopify.com",
      payload: {}
    })).resolves.toEqual({ duplicate: true, handled: true });
  });

  it("redacts customer data only inside the webhook shop", async () => {
    database.tx.customerToken.findMany.mockResolvedValue([
      { conversationId: "conversation-1" }
    ]);
    await processWebhookOnce({
      webhookId: "webhook-redact",
      topic: "CUSTOMERS_REDACT",
      shopDomain: "alpha.myshopify.com",
      payload: { customer: { id: 42 } }
    });

    expect(database.tx.customerToken.deleteMany).toHaveBeenCalledWith({
      where: {
        shopId: "shop-alpha",
        customerReference: {
          in: ["42", "gid://shopify/Customer/42"]
        }
      }
    });
    expect(database.tx.conversation.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ shopId: "shop-alpha" })
    });
    expect(database.tx.commerceSession.updateMany).toHaveBeenCalledWith({
      where: {
        shopId: "shop-alpha",
        customerId: { in: ["42", "gid://shopify/Customer/42"] }
      },
      data: {
        customerId: null,
        buyerContext: {},
        version: { increment: 1 }
      }
    });
  });
});
