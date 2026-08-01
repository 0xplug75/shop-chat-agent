import { afterEach, describe, expect, it, vi } from "vitest";
import {
  action as agentProfileAction,
  loader as agentProfileLoader,
} from "../app/routes/ucp.agent-profile";
import { createUcpProvider } from "../app/services/commerce/ucp-provider.server";
import {
  normalizeUcpResult,
  UCP_CAPABILITIES,
  UCP_VERSION,
  UcpClient,
} from "../app/services/commerce/ucp-client.server";

const context = {
  shopId: "shop-alpha",
  shopDomain: "alpha.myshopify.com",
  requestId: "request-1",
  conversationId: "8a9d4363-2ec0-4f7a-b958-da97481ee6fe",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Sage UCP agent profile", () => {
  it("advertises the catalog and cart capabilities used by the runtime", async () => {
    vi.stubEnv("UCP_CHECKOUT_ENABLED", "false");
    const response = await agentProfileLoader();
    const profile = await response.json();

    expect(profile.ucp).toMatchObject({
      version: UCP_VERSION,
      capabilities: {
        [UCP_CAPABILITIES.catalogSearch]: [{ version: UCP_VERSION }],
        [UCP_CAPABILITIES.catalogLookup]: [{ version: UCP_VERSION }],
        [UCP_CAPABILITIES.cart]: [{ version: UCP_VERSION }],
      },
    });
    expect(profile.ucp.capabilities).not.toHaveProperty(
      UCP_CAPABILITIES.checkout,
    );
    expect(response.headers.get("cache-control")).toContain("max-age=300");
  });

  it("advertises checkout only behind the global release gate", async () => {
    vi.stubEnv("UCP_CHECKOUT_ENABLED", "true");
    const response = await agentProfileLoader();
    const profile = await response.json();

    expect(profile.ucp.capabilities[UCP_CAPABILITIES.checkout]).toEqual([
      { version: UCP_VERSION },
    ]);
    expect((await agentProfileAction()).status).toBe(405);
  });
});

describe("UCP discovery and schema boundary", () => {
  it("discovers tools, validates arguments, and injects the agent profile", async () => {
    const fetchImpl = createUcpFetch();
    const client = new UcpClient({
      context,
      businessUrl: "https://business.example",
      agentProfileUrl: "https://agent.example/ucp/agent-profile",
      fetchImpl,
    });

    const discovery = await client.initialize();
    expect(discovery).toMatchObject({
      profileVersion: UCP_VERSION,
      endpoint: "https://business.example/api/ucp/mcp",
      capabilities: expect.arrayContaining([
        UCP_CAPABILITIES.catalogSearch,
        UCP_CAPABILITIES.cart,
      ]),
      tools: expect.arrayContaining(["search_catalog", "get_cart"]),
    });

    const result = await client.callTool("search_catalog", {
      catalog: { query: "snowboard", pagination: { limit: 3 } },
    });
    expect(result.structured.products).toHaveLength(1);

    const call = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(call).toMatchObject({
      method: "tools/call",
      params: {
        name: "search_catalog",
        arguments: {
          catalog: { query: "snowboard", pagination: { limit: 3 } },
          meta: {
            "ucp-agent": {
              profile: "https://agent.example/ucp/agent-profile",
            },
          },
        },
      },
    });
    expect(
      fetchImpl.mock.calls.every(([, options]) => options.redirect === "error"),
    ).toBe(true);
  });

  it("rejects a payload that does not match the advertised tool schema", async () => {
    const fetchImpl = createUcpFetch();
    const client = new UcpClient({
      context,
      businessUrl: "https://business.example",
      agentProfileUrl: "https://agent.example/ucp/agent-profile",
      fetchImpl,
    });
    await client.initialize();

    await expect(
      client.callTool("search_catalog", { catalog: { query: 42 } }),
    ).rejects.toMatchObject({ code: "UCP_ARGUMENTS_INVALID", status: 400 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a response that does not match the advertised output schema", async () => {
    const client = new UcpClient({
      context,
      businessUrl: "https://business.example",
      agentProfileUrl: "https://agent.example/ucp/agent-profile",
      fetchImpl: createUcpFetch({
        toolResult: { structuredContent: { products: "invalid" } },
      }),
    });

    await expect(
      client.callTool("search_catalog", {
        catalog: { query: "snowboard" },
      }),
    ).rejects.toMatchObject({
      code: "UCP_RESPONSE_SCHEMA_INVALID",
      status: 502,
    });
  });

  it("requires an explicit allowlist for external business hosts in production", async () => {
    expect(
      () =>
        new UcpClient({
          context,
          businessUrl: "https://business.example",
          agentProfileUrl: "https://agent.example/ucp/agent-profile",
          fetchImpl: createUcpFetch(),
          env: { APP_ENV: "production" },
        }),
    ).toThrow(expect.objectContaining({ code: "UCP_BUSINESS_URL_INVALID" }));

    const client = new UcpClient({
      context,
      businessUrl: "https://business.example",
      agentProfileUrl: "https://agent.example/ucp/agent-profile",
      fetchImpl: createUcpFetch(),
      env: {
        APP_ENV: "production",
        UCP_ALLOWED_BUSINESS_HOSTS: "business.example",
      },
    });
    await expect(client.initialize()).resolves.toMatchObject({
      profileVersion: UCP_VERSION,
    });
  });

  it("rejects an unsupported business protocol version", async () => {
    const profile = businessProfile();
    profile.ucp.version = "2025-01-01";
    const client = new UcpClient({
      context,
      businessUrl: "https://business.example",
      agentProfileUrl: "https://agent.example/ucp/agent-profile",
      fetchImpl: createUcpFetch({ profile }),
    });

    await expect(client.initialize()).rejects.toMatchObject({
      code: "UCP_VERSION_UNSUPPORTED",
      status: 409,
    });
  });

  it("surfaces business escalation and rejects unsafe continuation URLs", async () => {
    const escalationFetch = createUcpFetch({
      toolResult: {
        structuredContent: {
          checkout: {
            id: "checkout-1",
            status: "requires_escalation",
            continue_url: "https://business.example/checkout/1",
            messages: [{ type: "warning", severity: "requires_buyer_review" }],
          },
        },
      },
    });
    const client = new UcpClient({
      context,
      businessUrl: "https://business.example",
      agentProfileUrl: "https://agent.example/ucp/agent-profile",
      fetchImpl: escalationFetch,
    });
    const result = await client.callTool("get_checkout", { id: "checkout-1" });
    expect(result).toMatchObject({
      requiresEscalation: true,
      continueUrl: "https://business.example/checkout/1",
      warnings: [{ type: "warning" }],
    });

    const unsafeFetch = createUcpFetch({
      toolResult: {
        structuredContent: {
          checkout: {
            id: "checkout-1",
            continue_url: "http://127.0.0.1/private",
          },
        },
      },
    });
    const unsafeClient = new UcpClient({
      context,
      businessUrl: "https://business.example",
      agentProfileUrl: "https://agent.example/ucp/agent-profile",
      fetchImpl: unsafeFetch,
    });
    await expect(
      unsafeClient.callTool("get_checkout", { id: "checkout-1" }),
    ).rejects.toMatchObject({ code: "UCP_CONTINUE_URL_UNTRUSTED" });
  });

  it("preserves UCP business status and disclosure messages", () => {
    const result = normalizeUcpResult({
      structuredContent: {
        ucp: { version: UCP_VERSION, status: "error" },
        messages: [
          {
            type: "warning",
            presentation: "disclosure",
            content: "Review product restrictions.",
          },
        ],
      },
    });

    expect(result.status).toBe("error");
    expect(result.warnings).toHaveLength(1);
    expect(result.disclosures).toEqual(result.warnings);
  });
});

describe("UCP commerce provider", () => {
  it("uses full cart replacement semantics and preserves provider context", async () => {
    const calls = [];
    const client = createProviderClient(calls);
    const provider = createUcpProvider({ client });

    const result = await provider.addConfirmedItem({
      cartId: "cart-1",
      variantId: "variant-2",
      quantity: 2,
      idempotencyKey: `commerce:v1:${"a".repeat(64)}`,
    });

    expect(result.cartId).toBe("cart-1");
    const update = calls.find((call) => call.name === "update_cart");
    expect(update.args).toEqual({
      id: "cart-1",
      cart: {
        line_items: [
          { quantity: 1, item: { id: "variant-1" } },
          { quantity: 2, item: { id: "variant-2" } },
        ],
        context: { currency: "EUR" },
        attribution: { source: "intentcart" },
      },
    });
  });

  it("never exposes more than three normalized catalog products", async () => {
    const calls = [];
    const client = createProviderClient(calls, {
      searchProducts: Array.from({ length: 5 }, (_value, index) => ({
        id: `product-${index + 1}`,
        title: `Product ${index + 1}`,
        url: `https://business.example/products/${index + 1}`,
        variants: [],
      })),
    });
    const provider = createUcpProvider({ client });

    const result = await provider.searchCatalog({ query: "routine" });
    expect(result.products).toHaveLength(3);
    expect(result.products[0].provenance).toMatchObject({
      source: "ucp",
      sourceId: "product-1",
    });
  });

  it("formats catalog prices using each currency's minor-unit exponent", async () => {
    const client = createProviderClient([], {
      searchProducts: [
        {
          id: "product-jpy",
          title: "JPY product",
          variants: [
            {
              id: "variant-jpy",
              title: "Default",
              price: { amount: 1200, currency: "JPY" },
            },
          ],
        },
        {
          id: "product-kwd",
          title: "KWD product",
          variants: [
            {
              id: "variant-kwd",
              title: "Default",
              price: { amount: 12345, currency: "KWD" },
            },
          ],
        },
      ],
    });
    const provider = createUcpProvider({ client });

    const result = await provider.searchCatalog({ query: "currency" });
    expect(result.products[0].price).toBe("JPY 1200");
    expect(result.products[1].price).toBe("KWD 12.345");
  });

  it("refuses checkout completion unless the capability and feature are enabled", async () => {
    const provider = createUcpProvider({
      client: createProviderClient([]),
      checkoutEnabled: true,
      checkoutCompleteEnabled: false,
    });

    await expect(
      provider.completeCheckout({
        checkoutId: "checkout-1",
        checkout: {},
        idempotencyKey: "7b21f3e6-00dd-42e1-95e6-36c1420c5f36",
      }),
    ).rejects.toMatchObject({ code: "COMMERCE_CAPABILITY_UNAVAILABLE" });
  });
});

function createUcpFetch({ toolResult, profile = businessProfile() } = {}) {
  return vi.fn(async (_url, options = {}) => {
    if (options.method === "GET") return jsonResponse(profile);
    const body = JSON.parse(options.body);
    if (body.method === "tools/list") {
      return jsonResponse({
        jsonrpc: "2.0",
        id: body.id,
        result: { tools: advertisedTools() },
      });
    }
    return jsonResponse({
      jsonrpc: "2.0",
      id: body.id,
      result: toolResult || {
        structuredContent: {
          products: [{ id: "product-1", title: "Snowboard", variants: [] }],
        },
      },
    });
  });
}

function businessProfile() {
  const version = [{ version: UCP_VERSION }];
  return {
    ucp: {
      version: UCP_VERSION,
      services: {
        "dev.ucp.shopping": [
          {
            version: UCP_VERSION,
            transport: "mcp",
            endpoint: "https://business.example/api/ucp/mcp",
          },
        ],
      },
      capabilities: {
        [UCP_CAPABILITIES.catalogSearch]: version,
        [UCP_CAPABILITIES.catalogLookup]: version,
        [UCP_CAPABILITIES.cart]: version,
        [UCP_CAPABILITIES.checkout]: version,
      },
    },
  };
}

function advertisedTools() {
  return [
    tool(
      "search_catalog",
      {
        catalog: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
            pagination: { type: "object" },
          },
          additionalProperties: true,
        },
      },
      ["catalog"],
      {
        type: "object",
        required: ["products"],
        properties: { products: { type: "array" } },
        additionalProperties: true,
      },
    ),
    tool("get_cart", { id: { type: "string" } }, ["id"]),
    tool("get_checkout", { id: { type: "string" } }, ["id"]),
  ];
}

function tool(name, properties, required = ["catalog"], outputSchema) {
  return {
    name,
    inputSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: [...required, "meta"],
      properties: {
        ...properties,
        meta: {
          type: "object",
          required: ["ucp-agent"],
          properties: {
            "ucp-agent": {
              type: "object",
              required: ["profile"],
              properties: { profile: { type: "string", format: "uri" } },
            },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: false,
    },
    ...(outputSchema ? { outputSchema } : {}),
  };
}

function createProviderClient(calls, { searchProducts } = {}) {
  const tools = new Set([
    "search_catalog",
    "lookup_catalog",
    "get_product",
    "create_cart",
    "get_cart",
    "update_cart",
    "create_checkout",
    "get_checkout",
    "update_checkout",
    "complete_checkout",
  ]);
  return {
    async initialize() {
      return { profileVersion: UCP_VERSION, tools: [...tools] };
    },
    hasCapability() {
      return true;
    },
    hasTool(name) {
      return tools.has(name);
    },
    async callTool(name, args, options) {
      calls.push({ name, args, options });
      if (name === "search_catalog") {
        return ucpResult({ products: searchProducts || [] });
      }
      if (name === "get_cart") {
        return ucpResult({
          cart: {
            id: "cart-1",
            line_items: [{ quantity: 1, item: { id: "variant-1" } }],
            context: { currency: "EUR" },
            attribution: { source: "intentcart" },
          },
        });
      }
      if (name === "update_cart") {
        return ucpResult({ cart: { id: "cart-1", ...args.cart } });
      }
      return ucpResult({ checkout: { id: "checkout-1" } });
    },
  };
}

function ucpResult(structured) {
  const resource = structured.cart || structured.checkout || structured;
  return {
    structured,
    resource,
    messages: [],
    warnings: [],
    disclosures: [],
    status: resource.status || null,
    requiresEscalation: false,
    continueUrl: resource.continue_url || null,
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
