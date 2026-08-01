import { describe, expect, it, vi } from "vitest";
import {
  buildRecoveryState,
  canRestoreRecovery,
  markRecoveryRestored,
} from "../app/services/recovery.server";
import { assignVariant } from "../app/services/experiment.server";
import { DurableRateLimiter } from "../app/security/rate-limit.server";
import { buildCommerceEventData } from "../app/services/analytics-event.server";

describe("stable experiment assignment", () => {
  it("is deterministic and honors treatment boundaries", () => {
    const input = {
      shopId: "shop-alpha",
      visitorId: "ee35cc7f-4fba-4b75-8b6f-aeef3ccaa16d",
      experimentKey: "launcher_entry_v1",
    };
    expect(assignVariant({ ...input, treatmentPercentage: 0 })).toBe(
      "reactive",
    );
    expect(assignVariant({ ...input, treatmentPercentage: 100 })).toBe(
      "contextual",
    );
    expect(assignVariant({ ...input, treatmentPercentage: 50 })).toBe(
      assignVariant({ ...input, treatmentPercentage: 50 }),
    );
  });
});

describe("durable rate limiting", () => {
  it("isolates fixed buckets by shop and hashed visitor key", async () => {
    const counts = new Map();
    const store = {
      increment: vi.fn(async ({ id }) => {
        const count = (counts.get(id) || 0) + 1;
        counts.set(id, count);
        return { count };
      }),
    };
    const limiter = new DurableRateLimiter({
      limit: 2,
      windowMs: 60_000,
      store,
    });

    await expect(
      limiter.consume({ shopId: "shop-a", key: "visitor-1" }, 1_000),
    ).resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(
      limiter.consume({ shopId: "shop-a", key: "visitor-1" }, 1_001),
    ).resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(
      limiter.consume({ shopId: "shop-a", key: "visitor-1" }, 1_002),
    ).resolves.toMatchObject({ allowed: false, remaining: 0 });
    await expect(
      limiter.consume({ shopId: "shop-b", key: "visitor-1" }, 1_002),
    ).resolves.toMatchObject({ allowed: true, remaining: 1 });
    expect(store.increment.mock.calls[0][0].keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.increment.mock.calls[0][0].keyHash).not.toContain("visitor-1");
  });
});

describe("same-visitor recovery state", () => {
  it("persists intent, recommendations, and the exact cart candidate", () => {
    const expiresAt = new Date("2026-08-02T12:00:00.000Z");
    const record = {
      visitorId: "ee35cc7f-4fba-4b75-8b6f-aeef3ccaa16d",
      journeyStage: "CONFIRM",
      structuredIntent: { goal: "select_variant" },
      recommendedProducts: [{ id: "product-1" }],
      selectedProductId: "product-1",
      selectedVariantId: "variant-1",
      quantity: 2,
      cartId: null,
      checkoutUrl: null,
      pendingMessages: [
        {
          type: "cart_confirmation",
          confirmationId: "7b21f3e6-00dd-42e1-95e6-36c1420c5f36",
        },
      ],
      expiresAt,
    };
    const state = buildRecoveryState(
      record,
      {},
      new Date("2026-08-01T12:00:00.000Z"),
    );

    expect(state).toMatchObject({
      status: "available",
      intent: { goal: "select_variant" },
      recommendations: [{ id: "product-1" }],
      cartCandidate: {
        productId: "product-1",
        variantId: "variant-1",
        quantity: 2,
      },
    });
    expect(
      canRestoreRecovery(
        { ...record, recoveryState: state },
        {
          visitorId: record.visitorId,
          now: new Date("2026-08-01T13:00:00.000Z"),
        },
      ),
    ).toBe(true);
    expect(
      canRestoreRecovery(
        { ...record, recoveryState: state },
        { visitorId: "another-visitor" },
      ),
    ).toBe(false);
    expect(markRecoveryRestored(state).status).toBe("restored");
  });
});

describe("versioned commerce events", () => {
  it("carries tenant and experiment attribution while redacting secrets", () => {
    const event = buildCommerceEventData(
      {
        shopId: "shop-alpha",
        requestId: "request-1",
        experimentKey: "launcher_entry_v1",
        experimentVariant: "contextual",
      },
      {
        eventType: "ucp_handoff",
        conversationId: "c60f8b36-c699-4d3a-8d77-e768f5786acc",
        commerceSessionId: "session-1",
        payload: {
          requiresEscalation: true,
          token: "must-not-be-recorded",
          nested: { checkoutUrl: "https://secret.example/checkout" },
        },
      },
    );

    expect(event).toMatchObject({
      shopId: "shop-alpha",
      schemaVersion: "1.0",
      experimentKey: "launcher_entry_v1",
      experimentVariant: "contextual",
      payload: { requiresEscalation: true, nested: {} },
    });
    expect(event.payload.token).toBeUndefined();
  });

  it("rejects unversioned event names", () => {
    expect(() =>
      buildCommerceEventData(
        { shopId: "shop-alpha", requestId: "request-1" },
        { eventType: "arbitrary_event", payload: {} },
      ),
    ).toThrow("Unsupported commerce event");
  });
});
