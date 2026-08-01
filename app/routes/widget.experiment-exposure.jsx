import { z } from "zod";
import { ConversationIdSchema } from "../contracts/commerce.schemas.server";
import { getMerchantConfig } from "../merchant/merchant.server";
import { authenticateAppProxyContext } from "../security/app-proxy-context.server";
import { requireWidgetRequestContext } from "../security/merchant-context.server";
import { WidgetTokenError } from "../security/widget-token.server";
import {
  getExperimentAssignment,
  LAUNCHER_ENTRY_EXPERIMENT,
  recordExperimentExposure,
} from "../services/experiment.server";
import {
  readJsonBodyWithLimit,
  RequestTooLargeError,
} from "../services/chat-request.server";

const MAX_EXPOSURE_BYTES = 4 * 1024;

const ExperimentExposureRequestSchema = z
  .object({
    visitor_id: ConversationIdSchema,
    experiment_key: z.literal(LAUNCHER_ENTRY_EXPERIMENT),
    variant: z.enum(["reactive", "contextual"]),
    widget_token: z.string().min(1).max(8192),
  })
  .strict();

export async function loader() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

export async function action({ request }) {
  const proxy = await authenticateAppProxyContext(request);
  let context = proxy.context;
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_EXPOSURE_BYTES) {
    return json({ error: "Request is too large" }, 413, context.requestId);
  }

  let body;
  try {
    body = await readJsonBodyWithLimit(request, MAX_EXPOSURE_BYTES);
  } catch (error) {
    const status = error instanceof RequestTooLargeError ? 413 : 400;
    return json(
      { error: status === 413 ? "Request is too large" : "Invalid JSON" },
      status,
      context.requestId,
    );
  }

  const parsed = ExperimentExposureRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Invalid exposure" }, 400, context.requestId);
  }
  try {
    context = requireWidgetRequestContext(request, {
      token: parsed.data.widget_token,
      expectedContext: proxy.context,
      verifyOrigin: false,
    });
  } catch (error) {
    if (error instanceof WidgetTokenError) {
      return json({ error: "Unauthorized" }, 401, context.requestId);
    }
    throw error;
  }
  if (context.visitorId !== parsed.data.visitor_id) {
    return json({ error: "Unauthorized" }, 401, context.requestId);
  }

  const config = await getMerchantConfig(context);
  if (
    config.experiments.killSwitch ||
    !config.experiments.launcherEntry.enabled
  ) {
    return json(
      { recorded: false, reason: "disabled" },
      409,
      context.requestId,
    );
  }

  const assignment = await getExperimentAssignment(context, {
    visitorId: parsed.data.visitor_id,
    experimentKey: parsed.data.experiment_key,
  });
  if (!assignment || assignment.variant !== parsed.data.variant) {
    return json({ error: "Assignment mismatch" }, 409, context.requestId);
  }

  const recorded = await recordExperimentExposure(context, assignment);
  return json({ recorded }, 200, context.requestId);
}

function json(body, status, requestId) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "X-Request-Id": requestId,
    },
  });
}
