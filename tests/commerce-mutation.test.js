import { describe, expect, it, vi } from "vitest";
import {
  CommerceMutationError,
  createCommerceIdempotencyKey,
  createCommerceMutationCoordinator,
  createInMemoryCommerceMutationStore,
  createTurnSideEffectState,
  SIDE_EFFECT_STATES,
} from "../app/services/commerce-mutation.server";

const context = { shopId: "shop-alpha" };
const input = {
  context,
  commerceSessionId: "commerce-session-1",
  confirmationId: "a6d3e3cb-1675-48f4-9e14-29d79b28a37b",
  operation: "update_cart",
  request: {
    version: "1.0",
    productId: "gid://shopify/Product/1",
    variantId: "gid://shopify/ProductVariant/11",
    quantity: 1,
  },
};

describe("durable commerce mutation barrier", () => {
  it("journals a confirmed result and replays it without a second mutation", async () => {
    const store = createInMemoryCommerceMutationStore();
    const coordinator = createCommerceMutationCoordinator({ store });
    const perform = vi.fn().mockResolvedValue({
      cartId: "cart-1",
      cart: { id: "cart-1", lines: [{ quantity: 1 }] },
    });

    const first = await coordinator.execute({ ...input, perform });
    const second = await coordinator.execute({ ...input, perform });

    expect(first.status).toBe("executed");
    expect(second.status).toBe("replayed");
    expect(second.result).toEqual(first.result);
    expect(perform).toHaveBeenCalledTimes(1);
    expect([...store.records.values()][0]).toMatchObject({
      state: SIDE_EFFECT_STATES.CONFIRMED,
      result: first.result,
    });
  });

  it("marks a timeout unknown and never retries it blindly", async () => {
    const store = createInMemoryCommerceMutationStore();
    const coordinator = createCommerceMutationCoordinator({ store });
    const timeout = Object.assign(new Error("upstream timeout"), {
      code: "MCP_TIMEOUT",
    });
    const perform = vi.fn().mockRejectedValue(timeout);

    await expect(
      coordinator.execute({ ...input, perform }),
    ).rejects.toMatchObject({
      code: "SIDE_EFFECT_UNKNOWN",
      sideEffectState: SIDE_EFFECT_STATES.UNKNOWN,
      retryable: false,
    });
    await expect(
      coordinator.execute({ ...input, perform }),
    ).rejects.toMatchObject({
      code: "SIDE_EFFECT_UNKNOWN",
      retryable: false,
    });
    expect(perform).toHaveBeenCalledTimes(1);
    expect([...store.records.values()][0].state).toBe(
      SIDE_EFFECT_STATES.UNKNOWN,
    );
  });

  it("allows only one concurrent submit to cross the started barrier", async () => {
    const store = createInMemoryCommerceMutationStore();
    const coordinator = createCommerceMutationCoordinator({ store });
    let release;
    const perform = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const first = coordinator.execute({ ...input, perform });
    await vi.waitFor(() => {
      expect([...store.records.values()][0]?.state).toBe(
        SIDE_EFFECT_STATES.STARTED,
      );
    });
    await expect(
      coordinator.execute({ ...input, perform }),
    ).rejects.toMatchObject({
      code: "SIDE_EFFECT_IN_PROGRESS",
    });
    release({ cartId: "cart-1", cart: { id: "cart-1" } });
    await expect(first).resolves.toMatchObject({ status: "executed" });
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it("leaves a successful upstream call blocked if its result cannot be persisted", async () => {
    const memory = createInMemoryCommerceMutationStore();
    const store = {
      reserve: memory.reserve,
      transition: vi.fn(async (transition) => {
        if (transition.to === SIDE_EFFECT_STATES.CONFIRMED) {
          throw new Error("database unavailable");
        }
        return memory.transition(transition);
      }),
    };
    const coordinator = createCommerceMutationCoordinator({ store });
    const perform = vi.fn().mockResolvedValue({ cartId: "cart-1" });

    await expect(
      coordinator.execute({ ...input, perform }),
    ).rejects.toMatchObject({
      code: "SIDE_EFFECT_RESULT_NOT_PERSISTED",
      sideEffectState: SIDE_EFFECT_STATES.STARTED,
      retryable: false,
    });
    await expect(
      coordinator.execute({ ...input, perform }),
    ).rejects.toMatchObject({
      code: "SIDE_EFFECT_IN_PROGRESS",
    });
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it("rejects reuse of a confirmation for a different purchase candidate", async () => {
    const coordinator = createCommerceMutationCoordinator({
      store: createInMemoryCommerceMutationStore(),
    });
    const perform = vi.fn().mockResolvedValue({ cartId: "cart-1" });
    await coordinator.execute({ ...input, perform });

    await expect(
      coordinator.execute({
        ...input,
        request: { ...input.request, quantity: 2 },
        perform,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it("redacts sensitive fields before journal persistence", async () => {
    const store = createInMemoryCommerceMutationStore();
    const coordinator = createCommerceMutationCoordinator({ store });
    await coordinator.execute({
      ...input,
      request: { ...input.request, accessToken: "not-for-storage" },
      perform: async () => ({
        cartId: "cart-1",
        buyer_identity: { email: "private@example.test" },
      }),
    });

    const persisted = [...store.records.values()][0];
    expect(persisted.request.accessToken).toBeUndefined();
    expect(persisted.result.buyer_identity).toBeUndefined();
  });

  it("tracks whether provider fallback is still safe", () => {
    const turn = createTurnSideEffectState();
    expect(turn.state).toBe(SIDE_EFFECT_STATES.NONE);
    expect(turn.canFallback()).toBe(true);
    turn.observe(SIDE_EFFECT_STATES.REQUESTED);
    expect(turn.canFallback()).toBe(true);
    turn.observe(SIDE_EFFECT_STATES.STARTED);
    expect(turn.canFallback()).toBe(false);
    turn.observe(SIDE_EFFECT_STATES.CONFIRMED);
    expect(turn.canFallback()).toBe(false);
  });

  it("creates opaque stable idempotency keys", () => {
    const key = createCommerceIdempotencyKey({
      shopId: "shop-alpha",
      commerceSessionId: "session-1",
      confirmationId: "confirmation-1",
      operation: "update_cart",
    });
    expect(key).toMatch(/^commerce:v1:[a-f0-9]{64}$/);
    expect(key).not.toContain("shop-alpha");
  });

  it("exposes a typed reconciliation error", () => {
    const error = new CommerceMutationError("SIDE_EFFECT_UNKNOWN", "unknown", {
      state: SIDE_EFFECT_STATES.UNKNOWN,
    });
    expect(error.publicMessage).toContain("Check the cart");
  });
});
