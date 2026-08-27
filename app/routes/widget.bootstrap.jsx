import { authenticateAppProxyContext } from "../security/app-proxy-context.server";
import { issueWidgetToken } from "../security/widget-token.server";
import { ConversationIdSchema } from "../contracts/commerce.schemas.server";
import { getMerchantConfig } from "../merchant/merchant.server";
import { toPublicMerchantConfig } from "../merchant/public-config.server";
import {
  getOrCreateExperimentAssignment,
  LAUNCHER_ENTRY_EXPERIMENT,
} from "../services/experiment.server";
import { consumeWidgetBootstrapRateLimit } from "../security/rate-limit.server";

export async function loader({ request }) {
  const { context, shop } = await authenticateAppProxyContext(request, {
    refreshStorefrontOrigin: true,
  });
  let rateLimit;
  try {
    rateLimit = await consumeWidgetBootstrapRateLimit(context);
  } catch (_error) {
    return Response.json(
      {
        error: "Service temporarily unavailable",
        requestId: context.requestId,
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store, private",
          "X-Request-Id": context.requestId,
        },
      },
    );
  }
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Too many requests", requestId: context.requestId },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store, private",
          "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)),
          "X-Request-Id": context.requestId,
        },
      },
    );
  }
  const config = await getMerchantConfig(context);
  const visitorId = parseVisitorId(request);
  const launcherExperiment = config.experiments.launcherEntry;
  const experimentAssignment = await getOrCreateExperimentAssignment(context, {
    visitorId,
    experimentKey: LAUNCHER_ENTRY_EXPERIMENT,
    enabled: launcherExperiment.enabled,
    killSwitch: config.experiments.killSwitch,
    treatmentPercentage: launcherExperiment.treatmentPercentage,
  });
  const credential = issueWidgetToken({
    shopId: shop.id,
    shopDomain: shop.shopDomain,
    storefrontOrigin: shop.storefrontOrigin,
    visitorId,
  });
  const appProxyPath = getAppProxyPath(request);

  return Response.json(
    {
      ...credential,
      visitorId,
      shop: {
        domain: shop.shopDomain,
        storefrontOrigin: shop.storefrontOrigin,
      },
      config: toPublicMerchantConfig(config, { experimentAssignment }),
      endpoints: {
        chat: `${appProxyPath}/chat`,
        history: `${appProxyPath}/history`,
        sage: `${appProxyPath}/sage`,
        tokenStatus: `${appProxyPath}/auth/token-status`,
        experimentExposure: `${appProxyPath}/experiment-exposure`,
      },
      requestId: context.requestId,
    },
    {
      headers: {
        "Cache-Control": "no-store, private",
        "X-Request-Id": context.requestId,
      },
    },
  );
}

function parseVisitorId(request) {
  const value = new URL(request.url).searchParams.get("visitor_id");
  if (!value) return crypto.randomUUID();
  const parsed = ConversationIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new Response("Invalid visitor identifier", { status: 400 });
  }
  return parsed.data;
}

function getAppProxyPath(request) {
  const pathPrefix = new URL(request.url).searchParams.get("path_prefix");
  return pathPrefix && /^\/apps\/[a-zA-Z0-9_-]{1,80}$/.test(pathPrefix)
    ? pathPrefix
    : "/apps/intentcart";
}
