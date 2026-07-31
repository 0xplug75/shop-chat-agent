/**
 * CORS header helpers
 * Shared "resolve Origin header, build Access-Control-* response headers"
 * logic used by every endpoint the storefront widget calls cross-origin.
 */

import { isShopifyStorefrontOrigin, normalizeStorefrontOrigin } from "../security/shopify-domain.server";

export class CorsOriginError extends Error {
  constructor() {
    super("Origin is not allowed");
    this.name = "CorsOriginError";
    this.status = 403;
  }
}

/**
 * Build a CORS headers object for a response.
 * @param {Request} request - The incoming request
 * @param {Object} [options]
 * @param {string} [options.methods] - Access-Control-Allow-Methods value
 * @param {string} [options.allowedHeaders] - Access-Control-Allow-Headers value.
 *   Defaults to echoing the request's Access-Control-Request-Headers header
 *   (or "Content-Type, Accept" if that header is absent).
 * @param {boolean} [options.credentials] - Whether to set
 *   Access-Control-Allow-Credentials: true
 * @param {string|null} [options.maxAge] - Access-Control-Max-Age value.
 *   Pass null to omit the header entirely.
 * @returns {Object} Headers object suitable for a Response init
 */
export function buildCorsHeaders(request, {
  methods = "GET, POST, OPTIONS",
  allowedHeaders,
  credentials = false,
  maxAge = "86400",
  allowedOrigins = configuredOrigins(),
  allowShopifyStorefronts = true
} = {}) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers":
      allowedHeaders ?? "Content-Type, Accept, Authorization, X-Request-Id",
    "Vary": "Origin"
  };

  if (origin && isAllowedOrigin(origin, { allowedOrigins, allowShopifyStorefronts })) {
    headers["Access-Control-Allow-Origin"] = normalizeStorefrontOrigin(origin);
  }

  if (credentials) {
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  if (maxAge) {
    headers["Access-Control-Max-Age"] = maxAge;
  }

  return headers;
}

export function assertAllowedOrigin(request, options = {}) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;

  if (!isAllowedOrigin(origin, options)) {
    throw new CorsOriginError();
  }

  return normalizeStorefrontOrigin(origin);
}

export function isAllowedOrigin(origin, {
  allowedOrigins = configuredOrigins(),
  allowShopifyStorefronts = true
} = {}) {
  let normalized;
  try {
    normalized = normalizeStorefrontOrigin(origin);
  } catch (_error) {
    return false;
  }

  return allowedOrigins.includes(normalized) ||
    (allowShopifyStorefronts && isShopifyStorefrontOrigin(normalized));
}

function configuredOrigins() {
  return (process.env.WIDGET_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .flatMap((origin) => {
      try {
        return [normalizeStorefrontOrigin(origin)];
      } catch (_error) {
        return [];
      }
    });
}
