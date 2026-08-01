import Ajv2020 from "ajv/dist/2020.js";
import { readJsonResponseWithLimit } from "../../lib/fetch-with-timeout.server";
import { createLogger } from "../../lib/logger.server";
import { resolveEnvironment } from "../../config/runtime-urls";

export const UCP_VERSION = "2026-04-08";
export const UCP_CAPABILITIES = Object.freeze({
  cart: "dev.ucp.shopping.cart",
  checkout: "dev.ucp.shopping.checkout",
  catalogSearch: "dev.ucp.shopping.catalog.search",
  catalogLookup: "dev.ucp.shopping.catalog.lookup",
});

const SHOPPING_SERVICE = "dev.ucp.shopping";
const MAX_RESPONSE_BYTES = 2_000_000;

export class UcpClientError extends Error {
  constructor(
    code,
    message,
    { status = 502, retryable = false, details } = {},
  ) {
    super(message);
    this.name = "UcpClientError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
    this.publicMessage =
      "The commerce service could not complete this request.";
  }
}

export class UcpClient {
  constructor({
    context,
    businessUrl,
    agentProfileUrl,
    authorization,
    fetchImpl = global.fetch,
    connectTimeoutMs = 12_000,
    callTimeoutMs = 20_000,
    supportedVersions = [UCP_VERSION],
    env = global.process?.env || {},
    allowedBusinessHosts = env.UCP_ALLOWED_BUSINESS_HOSTS,
  } = {}) {
    if (!context?.shopId)
      throw new Error("Merchant context is required for UCP");
    if (typeof fetchImpl !== "function")
      throw new Error("fetch is required for UCP");

    this.context = context;
    this.environment = resolveEnvironment(env);
    this.businessOrigin = normalizeBusinessOrigin(businessUrl, context, {
      environment: this.environment,
      allowedBusinessHosts,
    });
    this.discoveryUrl = new URL(
      "/.well-known/ucp",
      this.businessOrigin,
    ).toString();
    this.agentProfileUrl = normalizeAgentProfileUrl(agentProfileUrl, {
      environment: this.environment,
    });
    this.authorization = normalizeAuthorization(authorization);
    this.fetchImpl = fetchImpl;
    this.connectTimeoutMs = connectTimeoutMs;
    this.callTimeoutMs = callTimeoutMs;
    this.supportedVersions = new Set(supportedVersions);
    this.profile = null;
    this.endpoint = null;
    this.tools = new Map();
    this.initialized = false;
    this.ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      validateFormats: false,
    });
    this.logger = createLogger({
      requestId: context.requestId,
      shopId: context.shopId,
      conversationId: context.conversationId,
    });
  }

  async initialize() {
    if (this.initialized) return this.snapshot();
    const profile = await this.discover();
    const service = selectShoppingService(profile, this.supportedVersions);
    this.endpoint = assertEndpoint(
      service.endpoint,
      this.businessOrigin,
      this.context,
    );
    const response = await this.rpc(
      "tools/list",
      {},
      { timeoutMs: this.connectTimeoutMs },
    );
    const tools = Array.isArray(response.result?.tools)
      ? response.result.tools
      : [];
    this.tools = new Map(
      tools
        .filter((tool) => typeof tool?.name === "string")
        .map((tool) => [
          tool.name,
          {
            name: tool.name,
            description: String(tool.description || ""),
            inputSchema: tool.inputSchema || tool.input_schema || null,
            outputSchema: tool.outputSchema || tool.output_schema || null,
          },
        ]),
    );
    this.initialized = true;
    this.logger.info("UCP commerce service connected", {
      businessHost: new URL(this.businessOrigin).hostname,
      toolCount: this.tools.size,
      profileVersion: profile.ucp.version,
    });
    return this.snapshot();
  }

  async discover() {
    const response = await this.request(this.discoveryUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      timeoutMs: this.connectTimeoutMs,
    });
    const profile = await parseJsonResponse(response);
    assertBusinessProfile(profile, this.supportedVersions);
    this.profile = profile;
    return profile;
  }

  snapshot() {
    return {
      profileVersion: this.profile?.ucp?.version || null,
      endpoint: this.endpoint,
      capabilities: Object.keys(this.profile?.ucp?.capabilities || {}),
      tools: [...this.tools.keys()],
    };
  }

  hasCapability(name) {
    const declarations = this.profile?.ucp?.capabilities?.[name];
    return (
      Array.isArray(declarations) &&
      declarations.some((item) => this.supportedVersions.has(item?.version))
    );
  }

  requireCapability(name) {
    if (!this.hasCapability(name)) {
      throw new UcpClientError(
        "UCP_CAPABILITY_UNAVAILABLE",
        `Business did not advertise a supported ${name} capability`,
        { status: 409, details: { capability: name } },
      );
    }
  }

  hasTool(name) {
    return this.tools.has(name);
  }

  async callTool(
    name,
    args = {},
    { idempotencyKey, requireAuthorization = false } = {},
  ) {
    await this.initialize();
    const tool = this.tools.get(name);
    if (!tool) {
      throw new UcpClientError(
        "UCP_TOOL_UNAVAILABLE",
        `Business did not advertise the ${name} tool`,
        { status: 409, details: { tool: name } },
      );
    }
    if (requireAuthorization && !this.authorization) {
      throw new UcpClientError(
        "UCP_AUTHORIZATION_REQUIRED",
        `${name} requires configured UCP authorization`,
        { status: 409 },
      );
    }

    const argumentsWithMeta = {
      ...args,
      meta: {
        ...(args.meta || {}),
        "ucp-agent": { profile: this.agentProfileUrl },
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
    };
    validateToolArguments(this.ajv, tool, argumentsWithMeta);

    const response = await this.rpc(
      "tools/call",
      { name, arguments: argumentsWithMeta },
      {
        timeoutMs: this.callTimeoutMs,
        authorization: requireAuthorization ? this.authorization : null,
      },
    );
    validateToolResult(this.ajv, tool, response.result);
    const result = normalizeUcpResult(response.result);
    result.continueUrl = validateContinueUrl(result.continueUrl);
    return result;
  }

  async rpc(method, params, { timeoutMs, authorization } = {}) {
    if (!this.endpoint && method !== "tools/list") {
      throw new UcpClientError(
        "UCP_NOT_INITIALIZED",
        "UCP endpoint is unavailable",
      );
    }
    const endpoint =
      this.endpoint ||
      selectShoppingService(this.profile, this.supportedVersions).endpoint;
    const response = await this.request(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method,
        params,
      }),
      timeoutMs,
    });
    const payload = await parseJsonResponse(response);
    if (payload?.error) {
      throw new UcpClientError(
        "UCP_PROTOCOL_ERROR",
        "UCP returned a JSON-RPC protocol error",
        {
          status: response.status >= 400 ? response.status : 502,
          retryable: Number(payload.error.code) !== -32001,
          details: { rpcCode: payload.error.code },
        },
      );
    }
    return payload;
  }

  async request(url, { timeoutMs, ...options }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url, {
        ...options,
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      throw new UcpClientError(
        error?.name === "AbortError" ? "UCP_TIMEOUT" : "UCP_NETWORK_ERROR",
        "UCP network request failed",
        { status: error?.name === "AbortError" ? 504 : 502, retryable: true },
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new UcpClientError("UCP_HTTP_ERROR", "UCP request was rejected", {
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
        details: {
          retryAfter: response.headers.get("retry-after"),
          upstreamRequestId: response.headers.get("x-request-id"),
        },
      });
    }
    return response;
  }
}

export function normalizeUcpResult(result) {
  const structured =
    result?.structuredContent ?? parseTextContent(result?.content) ?? {};
  const resource = structured.cart || structured.checkout || structured;
  const messages = Array.isArray(resource?.messages)
    ? resource.messages
    : Array.isArray(structured?.messages)
      ? structured.messages
      : [];
  const warnings = messages.filter((message) => message?.type === "warning");
  const explicitDisclosures = Array.isArray(resource?.disclosures)
    ? resource.disclosures
    : [];
  const disclosures = [
    ...explicitDisclosures,
    ...messages.filter(
      (message) =>
        message?.presentation === "disclosure" &&
        !explicitDisclosures.includes(message),
    ),
  ];
  const status = resource?.status || structured?.ucp?.status || null;
  return {
    raw: result,
    structured,
    resource,
    messages,
    warnings,
    disclosures,
    status,
    requiresEscalation:
      status === "requires_escalation" ||
      messages.some((message) =>
        ["requires_buyer_input", "requires_buyer_review"].includes(
          message?.severity,
        ),
      ),
    continueUrl: resource?.continue_url || structured?.continue_url || null,
  };
}

function assertBusinessProfile(profile, supportedVersions) {
  if (
    !profile ||
    typeof profile !== "object" ||
    typeof profile.ucp?.version !== "string" ||
    !profile.ucp?.services ||
    !profile.ucp?.capabilities
  ) {
    throw new UcpClientError(
      "UCP_DISCOVERY_INVALID",
      "Business UCP profile is missing services or capabilities",
      { status: 502 },
    );
  }
  if (supportedVersions && !supportedVersions.has(profile.ucp.version)) {
    throw new UcpClientError(
      "UCP_VERSION_UNSUPPORTED",
      "Business UCP profile uses an unsupported protocol version",
      { status: 409, details: { version: profile.ucp.version } },
    );
  }
}

function selectShoppingService(profile, supportedVersions) {
  assertBusinessProfile(profile, supportedVersions);
  const services = profile.ucp.services[SHOPPING_SERVICE];
  const selected = Array.isArray(services)
    ? services.find(
        (service) =>
          service?.transport === "mcp" &&
          supportedVersions.has(service?.version) &&
          typeof service?.endpoint === "string",
      )
    : null;
  if (!selected) {
    throw new UcpClientError(
      "UCP_SERVICE_UNAVAILABLE",
      "Business did not advertise a supported UCP shopping MCP service",
      { status: 409 },
    );
  }
  return selected;
}

function validateToolResult(ajv, tool, result) {
  if (!tool.outputSchema) return;
  const structured = result?.structuredContent;
  if (!structured || typeof structured !== "object") {
    throw new UcpClientError(
      "UCP_RESPONSE_SCHEMA_INVALID",
      `The ${tool.name} tool omitted its advertised structured response`,
      { status: 502 },
    );
  }

  let validate;
  try {
    validate = ajv.compile(tool.outputSchema);
  } catch (error) {
    throw new UcpClientError(
      "UCP_RESPONSE_SCHEMA_UNSUPPORTED",
      `The ${tool.name} output schema could not be compiled`,
      { status: 409, details: { reason: error.message } },
    );
  }
  if (!validate(structured)) {
    throw new UcpClientError(
      "UCP_RESPONSE_SCHEMA_INVALID",
      `The ${tool.name} response does not match its advertised schema`,
      {
        status: 502,
        details: (validate.errors || []).slice(0, 20).map((error) => ({
          path: error.instancePath,
          keyword: error.keyword,
          message: error.message,
        })),
      },
    );
  }
}

function validateToolArguments(ajv, tool, args) {
  if (!tool.inputSchema || typeof tool.inputSchema !== "object") {
    throw new UcpClientError(
      "UCP_SCHEMA_MISSING",
      `The ${tool.name} tool did not advertise an input schema`,
      { status: 409 },
    );
  }
  let validate;
  try {
    validate = ajv.compile(tool.inputSchema);
  } catch (error) {
    throw new UcpClientError(
      "UCP_SCHEMA_UNSUPPORTED",
      `The ${tool.name} input schema could not be compiled`,
      { status: 409, details: { reason: error.message } },
    );
  }
  if (!validate(args)) {
    throw new UcpClientError(
      "UCP_ARGUMENTS_INVALID",
      `Arguments for ${tool.name} do not match the advertised schema`,
      {
        status: 400,
        details: (validate.errors || []).slice(0, 20).map((error) => ({
          path: error.instancePath,
          keyword: error.keyword,
          message: error.message,
        })),
      },
    );
  }
}

async function parseJsonResponse(response) {
  try {
    return await readJsonResponseWithLimit(response, MAX_RESPONSE_BYTES);
  } catch (_error) {
    throw new UcpClientError(
      "UCP_RESPONSE_INVALID",
      "UCP returned an invalid or oversized JSON response",
      { status: 502 },
    );
  }
}

function parseTextContent(content) {
  const text = Array.isArray(content)
    ? content.find(
        (item) => item?.type === "text" && typeof item.text === "string",
      )?.text
    : null;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function normalizeBusinessOrigin(
  value,
  context,
  { environment, allowedBusinessHosts },
) {
  const candidate = value || `https://${context.shopDomain}`;
  const url = new URL(candidate);
  const stable = isStableEnvironment(environment);
  const allowedHosts = parseAllowedBusinessHosts(allowedBusinessHosts);
  const shopHost = String(context.shopDomain || "").toLowerCase();
  const accountHost = shopHost.replace(
    /\.myshopify\.com$/,
    ".account.myshopify.com",
  );
  const hostname = url.hostname.toLowerCase();
  const hostAllowed =
    !stable ||
    hostname === shopHost ||
    hostname === accountHost ||
    allowedHosts.has(hostname);
  if (
    (url.protocol !== "https:" && stable) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    isPrivateHost(url.hostname) ||
    (stable && Boolean(url.port)) ||
    !hostAllowed
  ) {
    throw new UcpClientError(
      "UCP_BUSINESS_URL_INVALID",
      "UCP business URL must be a public HTTPS origin",
      { status: 400 },
    );
  }
  return url.origin;
}

function normalizeAgentProfileUrl(value, { environment }) {
  if (!value) {
    throw new UcpClientError(
      "UCP_AGENT_PROFILE_REQUIRED",
      "UCP agent profile URL is required",
      { status: 500 },
    );
  }
  const url = new URL(value);
  const stable = isStableEnvironment(environment);
  if (
    (url.protocol !== "https:" && stable) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    isPrivateHost(url.hostname) ||
    (stable && isEphemeralHost(url.hostname))
  ) {
    throw new UcpClientError(
      "UCP_AGENT_PROFILE_INVALID",
      "UCP agent profile URL must be an absolute public URL",
      { status: 500 },
    );
  }
  return url.toString();
}

function parseAllowedBusinessHosts(value) {
  if (!value) return new Set();
  const normalized = new Set();
  for (const rawHost of String(value).split(",")) {
    const host = rawHost.trim().toLowerCase().replace(/\.$/, "");
    if (!host) continue;
    if (
      host.includes("://") ||
      host.includes("/") ||
      host.includes("?") ||
      host.includes("#") ||
      host.includes("*") ||
      isPrivateHost(host)
    ) {
      throw new UcpClientError(
        "UCP_ALLOWED_HOST_INVALID",
        "UCP_ALLOWED_BUSINESS_HOSTS must contain exact public hostnames",
        { status: 500 },
      );
    }
    normalized.add(host);
  }
  return normalized;
}

function assertEndpoint(value, businessOrigin, context) {
  const endpoint = new URL(value);
  const business = new URL(businessOrigin);
  const shopHost = String(context.shopDomain || "").toLowerCase();
  const expectedHosts = new Set([
    business.hostname.toLowerCase(),
    shopHost,
    shopHost.replace(/\.myshopify\.com$/, ".account.myshopify.com"),
  ]);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    !expectedHosts.has(endpoint.hostname.toLowerCase())
  ) {
    throw new UcpClientError(
      "UCP_ENDPOINT_UNTRUSTED",
      "UCP discovery advertised an untrusted MCP endpoint",
      { status: 502 },
    );
  }
  return endpoint.toString();
}

function normalizeAuthorization(value) {
  const token = String(value || "")
    .trim()
    .replace(/^Bearer\s+/i, "");
  return token ? `Bearer ${token}` : null;
}

function validateContinueUrl(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch (_error) {
    throw new UcpClientError(
      "UCP_CONTINUE_URL_INVALID",
      "UCP returned an invalid continuation URL",
      { status: 502 },
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    isPrivateHost(url.hostname)
  ) {
    throw new UcpClientError(
      "UCP_CONTINUE_URL_UNTRUSTED",
      "UCP returned an untrusted continuation URL",
      { status: 502 },
    );
  }
  return url.toString();
}

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "metadata.google.internal" ||
    host === "::" ||
    host === "::1" ||
    /^f[cd][0-9a-f]{2}:/i.test(host) ||
    /^fe[89ab][0-9a-f]:/i.test(host) ||
    /^::ffff:(127|10|192\.168|169\.254|172\.(1[6-9]|2\d|3[01]))\./i.test(
      host,
    ) ||
    /^0\./.test(host) ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

function isStableEnvironment(environment) {
  return environment === "preview" || environment === "production";
}

function isEphemeralHost(hostname) {
  return hostname.toLowerCase().endsWith(".trycloudflare.com");
}
