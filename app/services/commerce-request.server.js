import { z } from "zod";
import { createLogger } from "../lib/logger.server";
import { getMerchantConfig } from "../merchant/merchant.server";
import { consumeWidgetRateLimit } from "../security/rate-limit.server";
import { recordCommerceEvent } from "./analytics-event.server";
import {
  getCommerceSession,
  updateCommerceSession,
} from "./commerce-session.server";
import { createCommerceBoundary } from "./commerce/commerce-boundary.server";
import { createCommerceProvider } from "./commerce/provider-registry.server";

const OpaqueRefSchema = z.string().trim().min(1).max(128);
const CommerceRequestSchema = z
  .object({
    commerce_session_id: z.string().trim().min(1).max(128),
    handoff: z.record(z.string(), z.unknown()),
    commerce_inputs: z
      .object({
        variant_ref: OpaqueRefSchema,
        quantity: z.number().int().min(1).max(100),
      })
      .strict()
      .optional(),
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
    if (Boolean(value.commerce_inputs) === Boolean(value.confirmation)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide commerce_inputs or confirmation, but not both",
      });
    }
  });

export async function handlePublicCommerceRequest({ context, rawBody }) {
  const logger = createLogger({
    requestId: context.requestId,
    shopId: context.shopId,
  });
  const parsed = CommerceRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return response(
      { error: "Invalid commerce request", requestId: context.requestId },
      400,
      context,
    );
  }

  let rateLimit;
  try {
    rateLimit = await consumeWidgetRateLimit(context, {
      visitorId: context.visitorId,
    });
  } catch (error) {
    logger.error("Commerce rate limiter unavailable", { error });
    return response(
      {
        error: "Service temporarily unavailable",
        requestId: context.requestId,
      },
      503,
      context,
    );
  }
  if (!rateLimit.allowed) {
    return response(
      { error: "Too many requests", requestId: context.requestId },
      429,
      context,
      { "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)) },
    );
  }

  const session = await getCommerceSession(
    context,
    parsed.data.commerce_session_id,
  );
  if (
    !session ||
    (context.visitorId && session.visitorId !== context.visitorId)
  ) {
    return response(
      { error: "Commerce session not found", requestId: context.requestId },
      404,
      context,
    );
  }

  try {
    const merchantConfig = await getMerchantConfig(context);
    const provider = createCommerceProvider({ context, merchantConfig });
    const boundary = createCommerceBoundary({ provider });
    const result = parsed.data.confirmation
      ? await boundary.confirm({
          context,
          merchantConfig,
          session,
          handoff: parsed.data.handoff,
          confirmation: {
            confirmationId: parsed.data.confirmation.confirmation_id,
            decision: parsed.data.confirmation.decision,
          },
        })
      : await boundary.prepare({
          context,
          merchantConfig,
          session,
          handoff: parsed.data.handoff,
          commerceInputs: {
            variantRef: parsed.data.commerce_inputs.variant_ref,
            quantity: parsed.data.commerce_inputs.quantity,
          },
        });

    if (result.sessionPatch) {
      try {
        await updateCommerceSession(
          context,
          session.id,
          result.sessionPatch,
          session.version,
        );
      } catch (error) {
        logger.error(
          "Authoritative commerce outcome could not update the session projection",
          {
            error,
            resultId: result.envelope.resultId,
            resultStatus: result.envelope.result.status,
          },
        );
      }
    }
    try {
      await recordCommerceEvent(context, {
        eventType: "commerce_outcome",
        conversationId: session.conversationId,
        commerceSessionId: session.id,
        payload: result.outcomeEvent,
      });
    } catch (error) {
      logger.error("Commerce outcome event could not be persisted", {
        error,
        resultId: result.envelope.resultId,
        resultStatus: result.envelope.result.status,
      });
    }
    return response(
      {
        commerce_result: result.envelope,
        commerce_outcome: result.outcomeEvent,
      },
      200,
      context,
    );
  } catch (error) {
    logger.error("Commerce boundary request failed", {
      error,
      code: error?.code,
    });
    return response(
      {
        error: error.publicMessage || "The commerce action is unavailable",
        code: safeCode(error),
        requestId: context.requestId,
      },
      Number(error.status || 500),
      context,
    );
  }
}

function response(body, status, context, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Request-Id": context.requestId,
      ...headers,
    },
  });
}

function safeCode(error) {
  return String(error?.code || "COMMERCE_BOUNDARY_FAILED")
    .replace(/[^A-Z0-9_.:-]/gi, "_")
    .slice(0, 128);
}
