import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  getMerchantConfig: vi.fn(),
  getSession: vi.fn(),
  updateSession: vi.fn(),
  recordEvent: vi.fn(),
  prepare: vi.fn(),
  confirm: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("../app/lib/logger.server", () => ({
  createLogger: () => ({
    error: mocks.loggerError,
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock("../app/merchant/merchant.server", () => ({
  getMerchantConfig: mocks.getMerchantConfig,
}));

vi.mock("../app/security/rate-limit.server", () => ({
  consumeWidgetRateLimit: mocks.consumeRateLimit,
}));

vi.mock("../app/services/analytics-event.server", () => ({
  recordCommerceEvent: mocks.recordEvent,
}));

vi.mock("../app/services/commerce-session.server", () => ({
  getCommerceSession: mocks.getSession,
  updateCommerceSession: mocks.updateSession,
}));

vi.mock("../app/services/commerce/commerce-boundary.server", () => ({
  createCommerceBoundary: () => ({
    prepare: mocks.prepare,
    confirm: mocks.confirm,
  }),
}));

vi.mock("../app/services/commerce/provider-registry.server", () => ({
  createCommerceProvider: () => ({ id: "deterministic-shopify" }),
}));

import { handlePublicCommerceRequest } from "../app/services/commerce-request.server";

const context = Object.freeze({
  requestId: "request:commerce:001",
  shopId: "shop:alpha",
  visitorId: "visitor:alpha",
});

describe("public Commerce handoff route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true });
    mocks.getMerchantConfig.mockResolvedValue({ shopping: {} });
    mocks.getSession.mockResolvedValue({
      id: "session:commerce:001",
      conversationId: "conversation:001",
      visitorId: context.visitorId,
      version: 7,
    });
    mocks.updateSession.mockResolvedValue({});
    mocks.recordEvent.mockResolvedValue({});
    mocks.prepare.mockResolvedValue(authoritativeResult());
  });

  it("returns the authoritative result when local projections fail afterward", async () => {
    mocks.updateSession.mockRejectedValueOnce(new Error("session conflict"));
    mocks.recordEvent.mockRejectedValueOnce(new Error("analytics unavailable"));

    const response = await handlePublicCommerceRequest({
      context,
      rawBody: validRequest(),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      commerce_result: authoritativeResult().envelope,
      commerce_outcome: authoritativeResult().outcomeEvent,
    });
    expect(mocks.loggerError).toHaveBeenCalledTimes(2);
  });

  it("rejects a client-supplied cart reference before reaching Commerce", async () => {
    const response = await handlePublicCommerceRequest({
      context,
      rawBody: {
        ...validRequest(),
        commerce_inputs: {
          ...validRequest().commerce_inputs,
          cart_ref: "cart:not-owned",
        },
      },
    });

    expect(response.status).toBe(400);
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});

function validRequest() {
  return {
    commerce_session_id: "session:commerce:001",
    handoff: { kind: "CommerceIntentHandoff" },
    commerce_inputs: {
      variant_ref: "variant:001",
      quantity: 1,
    },
  };
}

function authoritativeResult() {
  return {
    envelope: {
      kind: "CommerceResultEnvelope",
      version: "1.0",
      resultId: "result:001",
      result: { status: "succeeded_authoritative" },
    },
    outcomeEvent: {
      kind: "CommerceOutcomeEvent",
      version: "1.0",
      outcome: "mutation_succeeded",
    },
    sessionPatch: { journeyStage: "CART" },
  };
}
