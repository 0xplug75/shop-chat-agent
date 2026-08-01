/* eslint-env node */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled =
  Boolean(process.env.TEST_DATABASE_URL) &&
  process.env.TEST_DATABASE_URL === process.env.DATABASE_URL;

describe.skipIf(!enabled)("PostgreSQL multi-tenant integration", () => {
  let prisma;
  let createKnowledgeService;
  let getOrCreateCommerceSession;
  let getCommerceSession;
  let updateCommerceSession;
  let getConversationHistory;
  let getEffectiveMerchantConfig;
  let getMerchantConfigSnapshot;
  let updateMerchantConfig;
  let getOrCreateExperimentAssignment;
  let recordExperimentExposure;
  let DurableRateLimiter;
  let PrismaRateLimitStore;
  let shopA;
  let shopB;

  beforeAll(async () => {
    ({ default: prisma } = await import("../app/db.server"));
    ({ createKnowledgeService } =
      await import("../app/services/knowledge.server"));
    ({ getOrCreateCommerceSession, getCommerceSession, updateCommerceSession } =
      await import("../app/services/commerce-session.server"));
    ({ getConversationHistory } =
      await import("../app/services/conversation.server"));
    ({
      getEffectiveMerchantConfig,
      getMerchantConfigSnapshot,
      updateMerchantConfig,
    } = await import("../app/merchant/merchant.server"));
    ({ getOrCreateExperimentAssignment, recordExperimentExposure } =
      await import("../app/services/experiment.server"));
    ({ DurableRateLimiter, PrismaRateLimitStore } =
      await import("../app/security/rate-limit.server"));

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    shopA = await prisma.shop.create({
      data: { shopDomain: `intentcart-a-${suffix}.myshopify.com` },
    });
    shopB = await prisma.shop.create({
      data: { shopDomain: `intentcart-b-${suffix}.myshopify.com` },
    });
  });

  afterAll(async () => {
    if (prisma && shopA && shopB) {
      await prisma.shop.deleteMany({
        where: { id: { in: [shopA.id, shopB.id] } },
      });
      await prisma.$disconnect();
    }
  });

  it("prevents one shop from loading another shop's commerce session", async () => {
    const conversationId = crypto.randomUUID();
    const sessionA = await getOrCreateCommerceSession(
      {
        shopId: shopA.id,
        shopDomain: shopA.shopDomain,
      },
      { conversationId, visitorId: crypto.randomUUID() },
    );

    await expect(
      getCommerceSession(
        {
          shopId: shopB.id,
          shopDomain: shopB.shopDomain,
        },
        sessionA.id,
      ),
    ).resolves.toBeNull();
  });

  it("isolates merchant configuration and conversation history by shop", async () => {
    await prisma.merchantConfig.create({
      data: {
        shopId: shopA.id,
        assistantName: "Tenant Alpha Assistant",
        personality: "alpha-only personality",
        brandVoice: "alpha-only voice",
        welcomeMessage: "alpha-only welcome",
        quickPrompts: ["Alpha prompt"],
        commerceRules: {},
        recommendationRules: { maxProducts: 2 },
      },
    });
    const configB = await getEffectiveMerchantConfig({
      shopId: shopB.id,
      shopDomain: shopB.shopDomain,
    });
    expect(configB.assistant.name).not.toBe("Tenant Alpha Assistant");

    const visitorId = crypto.randomUUID();
    const conversation = await prisma.conversation.create({
      data: { id: crypto.randomUUID(), shopId: shopA.id, visitorId },
    });
    await prisma.message.create({
      data: {
        shopId: shopA.id,
        conversationId: conversation.id,
        role: "user",
        content: "tenant alpha private message",
      },
    });

    await expect(
      getConversationHistory(
        {
          shopId: shopB.id,
          shopDomain: shopB.shopDomain,
        },
        conversation.id,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      getConversationHistory(
        {
          shopId: shopA.id,
          shopDomain: shopA.shopDomain,
          visitorId: crypto.randomUUID(),
        },
        conversation.id,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      getConversationHistory(
        { shopId: shopA.id, shopDomain: shopA.shopDomain, visitorId },
        conversation.id,
      ),
    ).resolves.toHaveLength(1);
  });

  it("isolates PostgreSQL full-text knowledge retrieval by shop", async () => {
    const knowledge = createKnowledgeService();
    const source = await knowledge.createKnowledgeSource(
      { shopId: shopA.id },
      {
        type: "FAQ",
        name: "Tenant A FAQ",
      },
    );
    const document = await knowledge.upsertKnowledgeDocument(
      { shopId: shopA.id },
      {
        sourceId: source.id,
        title: "Private tenant answer",
        content: "uniquewordalpha is visible only to tenant A",
      },
    );
    await knowledge.chunkKnowledgeDocument(
      { shopId: shopA.id },
      document.id,
      document.content,
    );

    await expect(
      knowledge.searchKnowledge(
        { shopId: shopA.id },
        {
          query: "uniquewordalpha",
        },
      ),
    ).resolves.toHaveLength(1);
    await expect(
      knowledge.searchKnowledge(
        { shopId: shopB.id },
        {
          query: "uniquewordalpha",
        },
      ),
    ).resolves.toEqual([]);
  });

  it("ignores inactive knowledge sources and respects result limits", async () => {
    const knowledge = createKnowledgeService();
    const activeSource = await knowledge.createKnowledgeSource(
      { shopId: shopA.id },
      {
        type: "GUIDE",
        name: "Active guides",
      },
    );
    const inactiveSource = await knowledge.createKnowledgeSource(
      { shopId: shopA.id },
      {
        type: "DOCUMENT",
        name: "Inactive documents",
        status: "INACTIVE",
      },
    );

    for (const [index, sourceId] of [
      activeSource.id,
      activeSource.id,
      inactiveSource.id,
    ].entries()) {
      const document = await knowledge.upsertKnowledgeDocument(
        { shopId: shopA.id },
        {
          sourceId,
          title: `Bounded result ${index}`,
          content: `boundedsearchterm document ${index}`,
        },
      );
      await knowledge.chunkKnowledgeDocument(
        { shopId: shopA.id },
        document.id,
        document.content,
      );
    }

    const results = await knowledge.searchKnowledge(
      { shopId: shopA.id },
      {
        query: "boundedsearchterm",
        limit: 1,
        maxCharacters: 6000,
      },
    );
    expect(results).toHaveLength(1);
    expect(results[0].reference.title).toMatch(/^Bounded result [01]$/);
  });

  it("restores only the same visitor inside the same tenant", async () => {
    const visitorId = crypto.randomUUID();
    let session = await getOrCreateCommerceSession(
      { shopId: shopA.id, shopDomain: shopA.shopDomain },
      { visitorId, allowRecovery: true, ttlSeconds: 3600 },
    );
    session = await updateCommerceSession(
      { shopId: shopA.id, shopDomain: shopA.shopDomain },
      session.id,
      {
        journeyStage: "CONFIRM",
        recommendedProducts: [{ id: "product-a", title: "Product A" }],
        selectedProductId: "product-a",
        selectedVariantId: "variant-a",
        quantity: 1,
        pendingMessages: [
          {
            type: "cart_confirmation",
            confirmationId: crypto.randomUUID(),
          },
        ],
      },
      session.version,
    );

    const restored = await getOrCreateCommerceSession(
      { shopId: shopA.id, shopDomain: shopA.shopDomain },
      { visitorId, allowRecovery: true, ttlSeconds: 3600 },
    );
    const otherTenant = await getOrCreateCommerceSession(
      { shopId: shopB.id, shopDomain: shopB.shopDomain },
      { visitorId, allowRecovery: true, ttlSeconds: 3600 },
    );

    expect(restored).toMatchObject({ id: session.id, wasRecovered: true });
    expect(restored.recoveryState.status).toBe("restored");
    expect(otherTenant.id).not.toBe(session.id);
    expect(otherTenant.wasRecovered).toBe(false);
  });

  it("records one atomic exposure for a stable shop assignment", async () => {
    const context = {
      shopId: shopA.id,
      shopDomain: shopA.shopDomain,
      requestId: crypto.randomUUID(),
    };
    const assignment = await getOrCreateExperimentAssignment(context, {
      visitorId: crypto.randomUUID(),
      experimentKey: "launcher_entry_v1",
      enabled: true,
      killSwitch: false,
      treatmentPercentage: 100,
    });

    await expect(recordExperimentExposure(context, assignment)).resolves.toBe(
      true,
    );
    await expect(recordExperimentExposure(context, assignment)).resolves.toBe(
      false,
    );
    await expect(
      prisma.commerceEvent.count({
        where: {
          shopId: shopA.id,
          eventType: "experiment_exposed",
          experimentKey: assignment.experimentKey,
          experimentVariant: assignment.variant,
        },
      }),
    ).resolves.toBe(1);
  });

  it("shares rate-limit counters while isolating shops", async () => {
    const limiter = new DurableRateLimiter({
      limit: 1,
      windowMs: 60_000,
      store: new PrismaRateLimitStore({ client: prisma }),
    });
    const now = Date.now();

    await expect(
      limiter.consume({ shopId: shopA.id, key: "same-visitor" }, now),
    ).resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(
      limiter.consume({ shopId: shopA.id, key: "same-visitor" }, now),
    ).resolves.toMatchObject({ allowed: false, remaining: 0 });
    await expect(
      limiter.consume({ shopId: shopB.id, key: "same-visitor" }, now),
    ).resolves.toMatchObject({ allowed: true, remaining: 0 });
  });

  it("persists a complete merchant configuration with optimistic locking", async () => {
    const context = { shopId: shopB.id, shopDomain: shopB.shopDomain };
    const snapshot = await getMerchantConfigSnapshot(context);
    const next = structuredClone(snapshot.config);
    next.assistant.name = "Tenant Beta Assistant";
    next.shopping.recommendationRules.maxProducts = 2;

    await expect(
      updateMerchantConfig(context, next, snapshot.version),
    ).resolves.toMatchObject({
      assistant: { name: "Tenant Beta Assistant" },
      shopping: { recommendationRules: { maxProducts: 2 } },
    });
    await expect(
      updateMerchantConfig(context, next, snapshot.version),
    ).rejects.toMatchObject({ status: 409 });
  });
});
