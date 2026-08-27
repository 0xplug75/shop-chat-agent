import { z } from "zod";
import { createLogger } from "../lib/logger.server";
import { getMerchantConfig } from "../merchant/merchant.server";
import { consumeWidgetRateLimit } from "../security/rate-limit.server";
import { recordCommerceEvent } from "./analytics-event.server";
import {
  getCommerceSession,
  getOrCreateCommerceSession,
  updateCommerceSession,
} from "./commerce-session.server";
import { createCommerceBoundary } from "./commerce/commerce-boundary.server";
import { createFixtureProvider } from "./commerce/fixture-provider.server";
import {
  createCanonicalExperienceIngressPort,
  createCommerceBoundaryPort,
  createNonLiveFixtureCatalogPort,
  createNonLiveFixtureDecisionPort,
  getNonLiveFixtureProducts,
  NON_LIVE_SAGE_MODE,
} from "./sage-integration/non-live-adapters.server";
import { createNoopSageObservabilityPort } from "./sage-integration/ports.server";
import { createSageProjectionPort } from "./sage-integration/projection.server";
import { SAGE_INTERLAB_PROTOCOL_VERSION } from "./sage-integration/protocol/1.0.0-rc.1.server";
import {
  createSageIntegrationRuntime,
  SageIntegrationError,
} from "./sage-integration/runtime.server";

const OpaqueRefSchema = z.string().trim().min(1).max(128);
const SageRequestSchema = z
  .object({
    protocol_version: z.literal(SAGE_INTERLAB_PROTOCOL_VERSION),
    operation: z.enum([
      "submit_intent",
      "submit_action",
      "confirm_commerce",
      "get_projection",
    ]),
    commerce_session_id: OpaqueRefSchema.optional(),
    conversation_id: OpaqueRefSchema.optional(),
    intent: z
      .object({ text: z.string().trim().min(1).max(2000) })
      .strict()
      .optional(),
    action: z.record(z.string(), z.unknown()).optional(),
    commerce_inputs: z
      .object({
        variant_ref: OpaqueRefSchema,
        quantity: z.number().int().min(1).max(100),
      })
      .strict()
      .optional(),
    handoff: z.record(z.string(), z.unknown()).optional(),
    confirmation: z
      .object({
        confirmation_id: OpaqueRefSchema,
        decision: z.enum(["accept", "decline"]),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const required = (field) => {
      if (value[field] === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required for ${value.operation}`,
        });
      }
    };
    if (value.operation === "submit_intent") required("intent");
    if (value.operation === "submit_action") {
      required("commerce_session_id");
      required("action");
    }
    if (value.operation === "confirm_commerce") {
      required("commerce_session_id");
      required("handoff");
      required("confirmation");
    }
    if (value.operation === "get_projection") {
      required("commerce_session_id");
    }
  });

export async function handleSageIntegrationRequest({
  context,
  rawBody,
  dependencies = {},
}) {
  const logger = createLogger({
    requestId: context.requestId,
    shopId: context.shopId,
  });
  const parsed = SageRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return json(
      { error: "Invalid Sage request", requestId: context.requestId },
      400,
      context,
    );
  }

  const consumeRateLimit =
    dependencies.consumeRateLimit || consumeWidgetRateLimit;
  try {
    const limit = await consumeRateLimit(context, {
      visitorId: context.visitorId,
    });
    if (!limit.allowed) {
      return json(
        { error: "Too many requests", requestId: context.requestId },
        429,
        context,
        { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
      );
    }
  } catch (error) {
    logger.error("Sage rate limiter unavailable", { error });
    return json(
      {
        error: "Service temporarily unavailable",
        requestId: context.requestId,
      },
      503,
      context,
    );
  }

  try {
    const merchantConfig = await (
      dependencies.getMerchantConfig || getMerchantConfig
    )(context);
    const session = await resolveSession({
      context,
      request: parsed.data,
      dependencies,
    });
    if (
      !session ||
      (context.visitorId && session.visitorId !== context.visitorId)
    ) {
      return json(
        { error: "Commerce session not found", requestId: context.requestId },
        404,
        context,
      );
    }
    const runtime =
      dependencies.runtime ||
      createConfiguredSageIntegrationRuntime({
        context,
        session,
        env: dependencies.env || process.env,
        recordEvent: dependencies.recordEvent || recordCommerceEvent,
        logger,
      });

    if (parsed.data.operation === "submit_intent") {
      const result = await runtime.submitIntent({
        context,
        session,
        shopperRequest: parsed.data.intent,
      });
      const updated = await persistPatch({
        context,
        session,
        patch: result.sessionPatch,
        dependencies,
      });
      return json(
        {
          protocol_version: SAGE_INTERLAB_PROTOCOL_VERSION,
          commerce_session_id: updated.id,
          mode: result.mode,
          live: result.live,
          decision: result.decision,
          projection: result.projection,
        },
        200,
        context,
      );
    }

    if (parsed.data.operation === "submit_action") {
      const result = await runtime.submitAction({
        context,
        merchantConfig,
        session,
        action: parsed.data.action,
        commerceInputs: parsed.data.commerce_inputs
          ? {
              variantRef: parsed.data.commerce_inputs.variant_ref,
              quantity: parsed.data.commerce_inputs.quantity,
            }
          : undefined,
      });
      if (result.sessionPatch) {
        await persistPatch({
          context,
          session,
          patch: result.sessionPatch,
          dependencies,
        });
      }
      return json(
        compact({
          protocol_version: SAGE_INTERLAB_PROTOCOL_VERSION,
          commerce_session_id: session.id,
          projection: result.projection,
          commerce_handoff: result.handoff,
          commerce_result: result.commerceResult,
          commerce_outcome: result.commerceOutcome,
        }),
        200,
        context,
      );
    }

    if (parsed.data.operation === "confirm_commerce") {
      const result = await runtime.confirmCommerce({
        context,
        merchantConfig,
        session,
        handoff: parsed.data.handoff,
        confirmation: {
          confirmationId: parsed.data.confirmation.confirmation_id,
          decision: parsed.data.confirmation.decision,
        },
      });
      await persistPatch({
        context,
        session,
        patch: result.sessionPatch,
        dependencies,
      });
      return json(
        compact({
          protocol_version: SAGE_INTERLAB_PROTOCOL_VERSION,
          commerce_session_id: session.id,
          projection: result.projection,
          commerce_result: result.commerceResult,
          commerce_outcome: result.commerceOutcome,
          reconciliation_status: result.reconciliationStatus,
        }),
        200,
        context,
      );
    }

    return json(runtime.getProjection({ context, session }), 200, context);
  } catch (error) {
    logger.error("Sage integration request failed", {
      error,
      code: error?.code,
    });
    return json(
      {
        error: error.publicMessage || "The Sage integration is unavailable",
        code: safeCode(error),
        requestId: context.requestId,
      },
      Number(error.status || 500),
      context,
    );
  }
}

export function createConfiguredSageIntegrationRuntime({
  context,
  session,
  env = process.env,
  recordEvent = recordCommerceEvent,
  logger = createLogger({
    requestId: context.requestId,
    shopId: context.shopId,
  }),
} = {}) {
  if (env.SAGE_INTEGRATION_MODE !== NON_LIVE_SAGE_MODE) {
    throw new SageIntegrationError(
      "SAGE_INTEGRATION_NOT_CONFIGURED",
      "A product-owned live Sage decision adapter is not configured",
      { status: 503 },
    );
  }
  if (env.NODE_ENV === "production") {
    throw new SageIntegrationError(
      "NON_LIVE_ADAPTER_FORBIDDEN",
      "Non-live Sage adapters cannot run in production",
      { status: 503 },
    );
  }

  const products = getNonLiveFixtureProducts();
  const catalog = createNonLiveFixtureCatalogPort({ products });
  const decision = createNonLiveFixtureDecisionPort();
  const commerce =
    env.NODE_ENV === "test"
      ? createCommerceBoundaryPort(
          createCommerceBoundary({
            provider: createFixtureProvider({
              products: products.map(toCommerceFixtureProduct),
            }),
          }),
        )
      : createBlockedNonLiveCommercePort();
  const observability = createSafeObservabilityPort({
    context,
    session,
    recordEvent,
    logger,
  });
  return createSageIntegrationRuntime({
    ports: {
      catalog,
      decision,
      experience: createCanonicalExperienceIngressPort(),
      commerce,
      projection: createSageProjectionPort(),
      observability: observability || createNoopSageObservabilityPort(),
    },
  });
}

async function resolveSession({ context, request, dependencies }) {
  if (request.commerce_session_id) {
    return (dependencies.getSession || getCommerceSession)(
      context,
      request.commerce_session_id,
    );
  }
  if (request.operation !== "submit_intent") return null;
  return (dependencies.getOrCreateSession || getOrCreateCommerceSession)(
    context,
    {
      conversationId: request.conversation_id,
      visitorId: context.visitorId,
      allowRecovery: false,
    },
  );
}

async function persistPatch({ context, session, patch, dependencies }) {
  return (dependencies.updateSession || updateCommerceSession)(
    context,
    session.id,
    patch,
    session.version,
  );
}

function createSafeObservabilityPort({
  context,
  session,
  recordEvent,
  logger,
}) {
  return {
    async record({ eventType, payload }) {
      try {
        await recordEvent(context, {
          eventType,
          conversationId: session.conversationId,
          commerceSessionId: session.id,
          payload,
        });
      } catch (error) {
        logger.warn("Sage observability event could not be persisted", {
          error,
          eventType,
        });
      }
    },
  };
}

function createBlockedNonLiveCommercePort() {
  const blocked = async () => {
    throw new SageIntegrationError(
      "NON_LIVE_COMMERCE_TEST_ONLY",
      "The non-live Commerce adapter is available only in deterministic tests",
      { status: 503 },
    );
  };
  return { prepare: blocked, confirm: blocked };
}

function toCommerceFixtureProduct(product) {
  return {
    id: product.reference.productId,
    productId: product.reference.productId,
    title: product.title,
    available: true,
    variants: product.variants,
  };
}

function json(body, status, context, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "X-Request-Id": context.requestId,
      ...headers,
    },
  });
}

function safeCode(error) {
  return String(error?.code || "SAGE_INTEGRATION_FAILED")
    .replace(/[^A-Z0-9_.:-]/gi, "_")
    .slice(0, 128);
}

function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}
