import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock("../app/lib/logger.server", () => ({
  createLogger: () => ({
    error: mocks.loggerError,
    info: vi.fn(),
    warn: mocks.loggerWarn,
  }),
}));

import { handleSageIntegrationRequest } from "../app/services/sage-integration-request.server";

describe("authenticated Sage App Proxy request boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a tenant-bound session and persists a validated decision", async () => {
    const runtime = runtimeMock();
    const dependencies = dependenciesFor(runtime);
    const response = await handleSageIntegrationRequest({
      context: context(),
      rawBody: {
        protocol_version: "1.0.0-rc.1",
        operation: "submit_intent",
        intent: { text: "Find a product" },
      },
      dependencies,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      protocol_version: "1.0.0-rc.1",
      commerce_session_id: "session:001",
      mode: "fixture_non_live",
      live: false,
    });
    expect(dependencies.getOrCreateSession).toHaveBeenCalledWith(
      context(),
      expect.objectContaining({ visitorId: "visitor:001" }),
    );
    expect(dependencies.updateSession).toHaveBeenCalledWith(
      context(),
      "session:001",
      { buyerContext: { sageIntegration: {} } },
      6,
    );
  });

  it("rejects protocol drift and any direct mutation operation", async () => {
    const dependencies = dependenciesFor(runtimeMock());
    const drift = await handleSageIntegrationRequest({
      context: context(),
      rawBody: {
        protocol_version: "1.0.0",
        operation: "submit_intent",
        intent: { text: "Find a product" },
      },
      dependencies,
    });
    const bypass = await handleSageIntegrationRequest({
      context: context(),
      rawBody: {
        protocol_version: "1.0.0-rc.1",
        operation: "mutate_cart",
        commerce_session_id: "session:001",
      },
      dependencies,
    });

    expect(drift.status).toBe(400);
    expect(bypass.status).toBe(400);
    expect(dependencies.consumeRateLimit).not.toHaveBeenCalled();
    expect(dependencies.runtime.submitAction).not.toHaveBeenCalled();
  });

  it("never exposes a session owned by another visitor", async () => {
    const dependencies = dependenciesFor(runtimeMock());
    dependencies.getSession.mockResolvedValue({
      ...session(),
      visitorId: "visitor:other",
    });
    const response = await handleSageIntegrationRequest({
      context: context(),
      rawBody: {
        protocol_version: "1.0.0-rc.1",
        operation: "get_projection",
        commerce_session_id: "session:001",
      },
      dependencies,
    });

    expect(response.status).toBe(404);
    expect(dependencies.runtime.getProjection).not.toHaveBeenCalled();
  });

  it("routes Commerce confirmation only through the integration runtime", async () => {
    const runtime = runtimeMock();
    runtime.confirmCommerce.mockResolvedValue({
      projection: { state: "cart" },
      commerceResult: {
        kind: "CommerceResultEnvelope",
        version: "1.0",
        resultId: "result:001",
        result: { status: "succeeded_authoritative" },
      },
      commerceOutcome: {
        kind: "CommerceOutcomeEvent",
        version: "1.0",
        outcome: "mutation_succeeded",
      },
      sessionPatch: { journeyStage: "CART" },
    });
    const dependencies = dependenciesFor(runtime);
    const handoff = {
      kind: "CommerceIntentHandoff",
      version: "1.1",
    };
    const response = await handleSageIntegrationRequest({
      context: context(),
      rawBody: {
        protocol_version: "1.0.0-rc.1",
        operation: "confirm_commerce",
        commerce_session_id: "session:001",
        handoff,
        confirmation: {
          confirmation_id: "confirmation:001",
          decision: "accept",
        },
      },
      dependencies,
    });

    expect(response.status).toBe(200);
    expect(runtime.confirmCommerce).toHaveBeenCalledWith(
      expect.objectContaining({
        context: context(),
        session: session(),
        handoff,
        confirmation: {
          confirmationId: "confirmation:001",
          decision: "accept",
        },
      }),
    );
    expect(dependencies.updateSession).toHaveBeenCalledWith(
      context(),
      "session:001",
      { journeyStage: "CART" },
      6,
    );
  });
});

function dependenciesFor(runtime) {
  return {
    runtime,
    consumeRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
    getMerchantConfig: vi.fn().mockResolvedValue({ shopping: {} }),
    getSession: vi.fn().mockResolvedValue(session()),
    getOrCreateSession: vi.fn().mockResolvedValue(session()),
    updateSession: vi.fn().mockImplementation(async (_context, id, patch) => ({
      ...session(),
      ...patch,
      id,
      version: 7,
    })),
  };
}

function runtimeMock() {
  return {
    submitIntent: vi.fn().mockResolvedValue({
      mode: "fixture_non_live",
      live: false,
      decision: { kind: "DecisionExperienceInput", version: "1.0" },
      projection: { kind: "SageExperienceProjection", version: "1.0" },
      sessionPatch: { buyerContext: { sageIntegration: {} } },
    }),
    submitAction: vi.fn(),
    confirmCommerce: vi.fn(),
    getProjection: vi.fn().mockReturnValue({ projection: { state: "cart" } }),
  };
}

function context() {
  return Object.freeze({
    requestId: "request:001",
    shopId: "shop:001",
    visitorId: "visitor:001",
  });
}

function session() {
  return {
    id: "session:001",
    conversationId: "conversation:001",
    visitorId: "visitor:001",
    version: 6,
    buyerContext: {},
  };
}
