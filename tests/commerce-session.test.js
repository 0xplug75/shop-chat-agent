import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  $transaction: vi.fn(),
  transaction: {
    conversation: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    commerceSession: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn()
    },
    message: { findMany: vi.fn() }
  },
  commerceSession: {
    findFirst: vi.fn(),
    updateMany: vi.fn()
  },
  message: { create: vi.fn() },
  merchantConfig: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn()
  },
  knowledgeSource: {
    create: vi.fn(),
    deleteMany: vi.fn()
  }
}));

vi.mock("../app/db.server", () => ({ default: database }));

import {
  appendUserMessage,
  assertJourneyTransition,
  getCommerceSession,
  getOrCreateCommerceSession,
  InvalidJourneyTransitionError,
  mergeConstraints,
  updateCommerceSession
} from "../app/services/commerce-session.server";
import { createKnowledgeService, chunkText } from "../app/services/knowledge.server";
import { getEffectiveMerchantConfig } from "../app/merchant/merchant.server";

const context = { shopId: "shop-alpha", shopDomain: "alpha.myshopify.com" };

describe("tenant-scoped commerce persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.$transaction.mockImplementation((callback) => callback(database.transaction));
    database.commerceSession.findFirst.mockResolvedValue(null);
    database.commerceSession.updateMany.mockResolvedValue({ count: 0 });
    database.message.create.mockResolvedValue({ id: "message-1" });
    database.knowledgeSource.create.mockImplementation(({ data }) => Promise.resolve(data));
  });

  it("allows only explicit commerce journey transitions", () => {
    expect(() => assertJourneyTransition("DISCOVER", "COMPARE")).not.toThrow();
    expect(() => assertJourneyTransition("CONFIRM", "CART")).not.toThrow();
    expect(() => assertJourneyTransition("DISCOVER", "CART"))
      .toThrow(InvalidJourneyTransitionError);
    expect(() => assertJourneyTransition("COMPLETED", "DISCOVER"))
      .toThrow(InvalidJourneyTransitionError);
  });

  it("merges new constraints without dropping previous shopper choices", () => {
    const merged = mergeConstraints({
      category: "snowboard",
      budget: { min: 300, currency: "EUR" },
      preferences: ["all mountain"],
      exclusions: ["used"]
    }, {
      category: null,
      useCase: "resort",
      budget: { min: null, max: 700, currency: null },
      attributes: { level: "intermediate" },
      preferences: ["all mountain", "lightweight"],
      exclusions: [],
      requestedProductIds: [],
      confidence: 0.9,
      missingInformation: [],
      goal: "discover"
    });

    expect(merged).toMatchObject({
      category: "snowboard",
      useCase: "resort",
      budget: { min: 300, max: 700, currency: "EUR" },
      attributes: { level: "intermediate" },
      preferences: ["all mountain", "lightweight"]
    });
  });

  it("always scopes reads, optimistic updates, and messages by shop", async () => {
    await expect(getCommerceSession(context, "commerce-1")).resolves.toBeNull();
    expect(database.commerceSession.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "commerce-1", shopId: "shop-alpha" }
    }));

    await expect(updateCommerceSession(context, "commerce-1", {
      journeyStage: "COMPARE"
    }, 4)).rejects.toMatchObject({ status: 409 });
    expect(database.commerceSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "commerce-1",
        shopId: "shop-alpha",
        version: 4
      })
    }));

    await appendUserMessage(context, { conversationId: "conversation-1" }, "hello");
    expect(database.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        shopId: "shop-alpha",
        conversationId: "conversation-1",
        role: "user"
      })
    });
  });

  it("expires a stale session and starts a new conversation", async () => {
    database.transaction.conversation.findFirst.mockResolvedValue({ id: "conversation-old" });
    database.transaction.commerceSession.findUnique.mockResolvedValue({
      id: "commerce-old",
      conversationId: "conversation-old",
      journeyStage: "COMPARE",
      expiresAt: new Date(Date.now() - 60_000),
      version: 2
    });
    database.transaction.commerceSession.update.mockResolvedValue({ id: "commerce-old" });
    database.transaction.conversation.update.mockResolvedValue({ id: "conversation-old" });
    database.transaction.conversation.create.mockImplementation(({ data }) =>
      Promise.resolve(data)
    );
    database.transaction.commerceSession.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: "commerce-new",
        journeyStage: "DISCOVER",
        version: 1,
        ...data
      })
    );
    database.transaction.message.findMany.mockResolvedValue([]);

    const result = await getOrCreateCommerceSession(context, {
      conversationId: "conversation-old",
      visitorId: "visitor-1"
    });

    expect(database.transaction.commerceSession.update).toHaveBeenCalledWith({
      where: { id: "commerce-old" },
      data: { journeyStage: "EXPIRED", version: { increment: 1 } }
    });
    expect(database.transaction.conversation.update).toHaveBeenCalledWith({
      where: { id: "conversation-old" },
      data: { status: "EXPIRED", endedAt: expect.any(Date) }
    });
    expect(result).toMatchObject({
      id: "commerce-new",
      journeyStage: "DISCOVER"
    });
    expect(result.conversationId).not.toBe("conversation-old");
  });

  it("injects the tenant into knowledge writes and retrieval", async () => {
    const retriever = { search: vi.fn().mockResolvedValue([]) };
    const service = createKnowledgeService({ retriever });
    await service.createKnowledgeSource(context, {
      type: "FAQ",
      name: "Approved FAQ"
    });
    expect(database.knowledgeSource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ shopId: "shop-alpha", type: "FAQ" })
    });

    await service.searchKnowledge(context, { query: "returns" });
    expect(retriever.search).toHaveBeenCalledWith(context, { query: "returns" });
  });

  it("chunks merchant knowledge deterministically within the configured bound", () => {
    const chunks = chunkText(`${"a".repeat(250)}\n\n${"b".repeat(250)}`, 300);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.length <= 300)).toBe(true);
    expect(() => chunkText("content", 100)).toThrow("Invalid knowledge chunk size");
  });

  it("reads merchant configuration through the current shop only", async () => {
    database.merchantConfig.findUnique.mockResolvedValue({
      shopId: "shop-alpha",
      assistantName: "Sage",
      personality: "calm, useful, and conversion-aware",
      brandVoice: "clear, helpful, premium but not pushy",
      welcomeMessage: "Tell me what you are looking for and I will help you choose.",
      quickPrompts: ["Find the right product"],
      commerceRules: {
        bundleStrategy: "none",
        bestsellerPriority: "medium",
        outOfStockPolicy: "explain_and_suggest_alternatives"
      },
      recommendationRules: {
        maxProducts: 3,
        requireVariantConfirmation: true,
        preferAvailableInventory: true
      },
      version: 1
    });

    const config = await getEffectiveMerchantConfig(context);
    expect(config.assistant.name).toBe("Sage");
    expect(database.merchantConfig.findUnique).toHaveBeenCalledWith({
      where: { shopId: "shop-alpha" }
    });
  });
});
