/**
 * CORS header helpers
 * Shared "resolve Origin header, build Access-Control-* response headers"
 * logic used by every endpoint the storefront widget calls cross-origin.
 */

/**
 * Resolve the request's Origin header, falling back to "*".
 * @param {Request} request - The incoming request
 * @returns {string} The Origin header value, or "*" if absent
 */
export function resolveOrigin(request) {
  return request.headers.get("Origin") || "*";
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
  maxAge = "86400"
} = {}) {
  const headers = {
    "Access-Control-Allow-Origin": resolveOrigin(request),
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers":
      allowedHeaders ?? (request.headers.get("Access-Control-Request-Headers") || "Content-Type, Accept")
  };

  if (credentials) {
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  if (maxAge) {
    headers["Access-Control-Max-Age"] = maxAge;
  }

  return headers;
}
