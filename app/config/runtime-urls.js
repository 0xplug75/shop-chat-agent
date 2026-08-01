import { normalizeStorefrontOrigin } from "../security/shopify-domain.server";

const STABLE_ENVIRONMENTS = new Set(["preview", "production"]);
const VALID_ENVIRONMENTS = new Set([
  "development",
  "test",
  "preview",
  "production",
]);

export class RuntimeUrlConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "RuntimeUrlConfigurationError";
    this.code = "runtime_url_configuration_invalid";
    this.status = 500;
  }
}

export function resolveRuntimeUrls(env = global.process?.env || {}) {
  const environment = resolveEnvironment(env);
  const configuredAppUrl = optional(env.SHOPIFY_APP_URL);
  const configuredAlias = optional(env.APP_URL);

  const shopifyAppUrl = configuredAppUrl
    ? normalizeApplicationOrigin(
        configuredAppUrl,
        environment,
        "SHOPIFY_APP_URL",
      )
    : null;
  const appUrlAlias = configuredAlias
    ? normalizeApplicationOrigin(configuredAlias, environment, "APP_URL")
    : null;

  if (shopifyAppUrl && appUrlAlias && shopifyAppUrl !== appUrlAlias) {
    throw new RuntimeUrlConfigurationError(
      "APP_URL and SHOPIFY_APP_URL must resolve to the same origin",
    );
  }

  const appUrl =
    shopifyAppUrl || appUrlAlias || developmentFallback(env, environment);
  if (!appUrl) {
    throw new RuntimeUrlConfigurationError(
      "SHOPIFY_APP_URL or APP_URL is required in preview and production",
    );
  }

  const customerOAuthRedirectUrl = resolveCustomerRedirect(
    env.REDIRECT_URL,
    appUrl,
    environment,
  );
  return Object.freeze({
    environment,
    appUrl,
    adminAuthCallbackUrl: `${appUrl}/auth/callback`,
    customerOAuthRedirectUrl,
    appProxyUrl: `${appUrl}/widget`,
    healthcheckUrl: `${appUrl}/health`,
    widgetAllowedOrigins: Object.freeze(
      resolveWidgetOrigins(env.WIDGET_ALLOWED_ORIGINS),
    ),
  });
}

export function resolveEnvironment(env = global.process?.env || {}) {
  const railwayEnvironment = optional(
    env.RAILWAY_ENVIRONMENT_NAME,
  )?.toLowerCase();
  const configured = optional(env.APP_ENV)?.toLowerCase();
  const value =
    configured ||
    (railwayEnvironment === "production" ? "production" : null) ||
    (railwayEnvironment ? "preview" : null) ||
    (env.NODE_ENV === "test" ? "test" : "development");

  if (!VALID_ENVIRONMENTS.has(value)) {
    throw new RuntimeUrlConfigurationError(
      "APP_ENV must be development, test, preview, or production",
    );
  }
  return value;
}

export function normalizeApplicationOrigin(
  value,
  environment,
  source = "application URL",
) {
  const url = parseUrl(value, source);
  if (url.username || url.password) {
    throw new RuntimeUrlConfigurationError(
      `${source} must not contain credentials`,
    );
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new RuntimeUrlConfigurationError(
      `${source} must contain only an origin`,
    );
  }
  if (STABLE_ENVIRONMENTS.has(environment)) {
    if (url.protocol !== "https:") {
      throw new RuntimeUrlConfigurationError(
        `${source} must use HTTPS in ${environment}`,
      );
    }
    if (isEphemeralHost(url.hostname) || isLocalHost(url.hostname)) {
      throw new RuntimeUrlConfigurationError(
        `${source} must use a stable public hostname in ${environment}`,
      );
    }
  } else if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new RuntimeUrlConfigurationError(`${source} must use HTTP or HTTPS`);
  }
  return url.origin;
}

function resolveCustomerRedirect(configured, appUrl, environment) {
  const expected = new URL("/customer-auth/callback", appUrl);
  if (!optional(configured)) return expected.toString();

  const redirect = parseUrl(configured, "REDIRECT_URL");
  if (
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash
  ) {
    throw new RuntimeUrlConfigurationError(
      "REDIRECT_URL must not contain credentials, a query, or a fragment",
    );
  }
  if (redirect.origin !== appUrl) {
    throw new RuntimeUrlConfigurationError(
      "REDIRECT_URL must use the canonical application origin",
    );
  }
  if (STABLE_ENVIRONMENTS.has(environment) && redirect.protocol !== "https:") {
    throw new RuntimeUrlConfigurationError(
      `REDIRECT_URL must use HTTPS in ${environment}`,
    );
  }
  return redirect.toString();
}

function resolveWidgetOrigins(value) {
  if (!optional(value)) return [];
  return [
    ...new Set(
      String(value)
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
        .map((origin) => {
          try {
            return normalizeStorefrontOrigin(origin);
          } catch (_error) {
            throw new RuntimeUrlConfigurationError(
              "WIDGET_ALLOWED_ORIGINS contains an invalid storefront origin",
            );
          }
        }),
    ),
  ];
}

function developmentFallback(env, environment) {
  if (STABLE_ENVIRONMENTS.has(environment)) return null;
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RuntimeUrlConfigurationError("PORT must be a valid TCP port");
  }
  return `http://localhost:${port}`;
}

function parseUrl(value, source) {
  try {
    return new URL(String(value));
  } catch (_error) {
    throw new RuntimeUrlConfigurationError(`${source} must be an absolute URL`);
  }
}

function isEphemeralHost(hostname) {
  return hostname.toLowerCase().endsWith(".trycloudflare.com");
}

function isLocalHost(hostname) {
  return ["localhost", "127.0.0.1", "::1"].includes(hostname.toLowerCase());
}

function optional(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}
