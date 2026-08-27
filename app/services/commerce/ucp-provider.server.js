import { createBusinessMessageInterpreter } from "../business-message-interpreter.server";
import {
  CommerceProviderError,
  commerceProviderCapabilities,
} from "./provider-contract.server";
import { UCP_CAPABILITIES } from "./ucp-client.server";

export function createUcpProvider({
  client,
  policySearch,
  checkoutEnabled = false,
  clock = () => new Date(),
} = {}) {
  if (!client) throw new Error("UCP client is required");
  const interpreter = createBusinessMessageInterpreter();
  let initialized = false;
  let snapshot = null;

  const provider = {
    id: "ucp",
    get capabilities() {
      return commerceProviderCapabilities({
        catalogSearch:
          Boolean(snapshot) &&
          client.hasCapability(UCP_CAPABILITIES.catalogSearch) &&
          client.hasTool("search_catalog"),
        catalogLookup:
          Boolean(snapshot) &&
          client.hasCapability(UCP_CAPABILITIES.catalogLookup) &&
          client.hasTool("lookup_catalog"),
        productGet:
          Boolean(snapshot) &&
          client.hasCapability(UCP_CAPABILITIES.catalogLookup) &&
          client.hasTool("get_product"),
        policies: typeof policySearch === "function",
        cartCreate:
          Boolean(snapshot) &&
          client.hasCapability(UCP_CAPABILITIES.cart) &&
          client.hasTool("create_cart"),
        cartGet:
          Boolean(snapshot) &&
          client.hasCapability(UCP_CAPABILITIES.cart) &&
          client.hasTool("get_cart"),
        cartUpdate:
          Boolean(snapshot) &&
          client.hasCapability(UCP_CAPABILITIES.cart) &&
          client.hasTool("update_cart"),
        checkoutCreate:
          checkoutEnabled &&
          Boolean(snapshot) &&
          client.hasCapability(UCP_CAPABILITIES.checkout) &&
          client.hasTool("create_checkout"),
        checkoutGet:
          checkoutEnabled &&
          Boolean(snapshot) &&
          client.hasTool("get_checkout"),
        checkoutUpdate:
          checkoutEnabled &&
          Boolean(snapshot) &&
          client.hasTool("update_checkout"),
        checkoutComplete: false,
      });
    },

    async initialize() {
      if (!initialized) {
        snapshot = await client.initialize();
        initialized = true;
      }
      return { ...snapshot, capabilities: provider.capabilities };
    },

    async searchCatalog({ query, context = {} }) {
      await requireReady(provider);
      requireCapability(provider.capabilities.catalogSearch, "catalog search");
      const result = await client.callTool("search_catalog", {
        catalog: compact({
          query,
          context: toUcpContext(context.buyerContext),
          filters: context.catalogFilters,
          pagination: { limit: 3 },
        }),
      });
      return catalogResult("search_catalog", result, clock);
    },

    async lookupCatalog({ ids = [], context = {} }) {
      await requireReady(provider);
      requireCapability(provider.capabilities.catalogLookup, "catalog lookup");
      const result = await client.callTool("lookup_catalog", {
        catalog: compact({
          ids,
          context: toUcpContext(context.buyerContext),
        }),
      });
      return catalogResult("lookup_catalog", result, clock);
    },

    async getProduct({ id, context = {} }) {
      await requireReady(provider);
      requireCapability(provider.capabilities.productGet, "product lookup");
      const result = await client.callTool("get_product", {
        catalog: compact({
          id,
          context: toUcpContext(context.buyerContext),
        }),
      });
      const raw =
        result.structured?.product || result.resource?.product || null;
      return {
        toolName: "get_product",
        response: result,
        product: raw ? normalizeProduct(raw, clock) : null,
        messages: result.messages,
      };
    },

    async searchPolicies(input) {
      if (typeof policySearch !== "function") {
        throw new CommerceProviderError(
          "POLICY_SOURCE_UNAVAILABLE",
          "This commerce provider has no approved policy source",
          { status: 409 },
        );
      }
      return policySearch(input);
    },

    async getCart({ cartId }) {
      await requireReady(provider);
      requireCapability(provider.capabilities.cartGet, "cart read");
      const result = await client.callTool("get_cart", { id: cartId });
      return cartResult("get_cart", result, interpreter);
    },

    async addConfirmedItem({
      cartId,
      variantId,
      quantity,
      idempotencyKey,
      buyerContext = {},
    }) {
      assertInternalIdempotencyKey(idempotencyKey);
      await requireReady(provider);

      if (!cartId) {
        requireCapability(provider.capabilities.cartCreate, "cart create");
        const result = await client.callTool(
          "create_cart",
          {
            cart: compact({
              line_items: [writeLine(variantId, quantity)],
              context: toUcpContext(buyerContext),
            }),
          },
          { idempotencyKey },
        );
        return cartResult("create_cart", result, interpreter);
      }

      requireCapability(provider.capabilities.cartUpdate, "cart update");
      const current = await provider.getCart({ cartId });
      const fullCart = buildFullCartUpdate(current.cart, variantId, quantity);
      const result = await client.callTool(
        "update_cart",
        {
          id: cartId,
          cart: fullCart,
        },
        { idempotencyKey },
      );
      return cartResult("update_cart", result, interpreter);
    },

    async createCheckoutHandoff({ cartId, cartSnapshot, idempotencyKey }) {
      await requireReady(provider);
      if (checkoutEnabled) {
        requireCapability(
          provider.capabilities.checkoutCreate,
          "checkout create",
        );
        assertInternalIdempotencyKey(idempotencyKey);
        const result = await client.callTool(
          "create_checkout",
          { cart_id: cartId },
          { idempotencyKey, requireAuthorization: true },
        );
        return checkoutResult("create_checkout", cartId, result);
      }

      const snapshotUrl = findContinueUrl(cartSnapshot);
      if (snapshotUrl)
        return { cartId, checkoutUrl: snapshotUrl, status: "handoff" };
      const current = await provider.getCart({ cartId });
      return {
        cartId,
        checkoutUrl: current.continueUrl,
        status: "handoff",
        messages: current.messages,
        warnings: current.warnings,
        disclosures: current.disclosures,
      };
    },

    async getCheckout({ checkoutId }) {
      await requireReady(provider);
      requireCapability(provider.capabilities.checkoutGet, "checkout read");
      const result = await client.callTool(
        "get_checkout",
        { id: checkoutId },
        { requireAuthorization: true },
      );
      return checkoutResult("get_checkout", null, result);
    },

    async updateCheckout({ checkoutId, checkout }) {
      await requireReady(provider);
      requireCapability(
        provider.capabilities.checkoutUpdate,
        "checkout update",
      );
      const result = await client.callTool(
        "update_checkout",
        { id: checkoutId, checkout },
        { requireAuthorization: true },
      );
      return checkoutResult("update_checkout", null, result);
    },

    async completeCheckout() {
      await requireReady(provider);
      requireCapability(
        provider.capabilities.checkoutComplete,
        "checkout completion",
      );
    },
  };

  return provider;
}

async function requireReady(provider) {
  await provider.initialize();
}

function requireCapability(enabled, label) {
  if (!enabled) {
    throw new CommerceProviderError(
      "COMMERCE_CAPABILITY_UNAVAILABLE",
      `The provider did not advertise a supported ${label} capability`,
      { status: 409 },
    );
  }
}

function catalogResult(toolName, result, clock) {
  const products = Array.isArray(result.structured?.products)
    ? result.structured.products.map((product) =>
        normalizeProduct(product, clock),
      )
    : [];
  return {
    toolName,
    response: result,
    products: products.slice(0, 3),
    messages: result.messages,
    warnings: result.warnings,
    disclosures: result.disclosures,
  };
}

function normalizeProduct(product, clock) {
  const variants = Array.isArray(product.variants)
    ? product.variants
        .filter((variant) => variant?.id)
        .map((variant) => ({
          id: String(variant.id),
          title: String(variant.title || ""),
          price: displayMoney(variant.price),
          currency: variant.price?.currency || "",
          unitPrice: normalizeMinorMoney(variant.price),
          available:
            variant.availability?.available ?? variant.available ?? null,
          quantityAvailable:
            variant.quantityAvailable ??
            variant.quantity_available ??
            variant.availableQuantity ??
            variant.availability?.quantity ??
            null,
          selected_options: (variant.options || []).map(
            (option) =>
              `${option.name || "Option"}: ${option.label || option.value || ""}`,
          ),
        }))
    : [];
  const firstImage = (product.media || []).find(
    (item) => item?.type === "image",
  );
  const id = String(product.id || "");
  return {
    id,
    product_id: id,
    handle: product.handle || null,
    title: String(product.title || "Product"),
    description:
      typeof product.description === "string"
        ? product.description
        : product.description?.plain || "",
    url: product.url || "",
    image_url: firstImage?.url || "",
    price: displayMoney(product.price_range?.min) || variants[0]?.price || "",
    price_range: product.price_range || null,
    variants,
    available:
      product.availability?.available ??
      product.available ??
      variants.some((variant) => variant.available === true),
    rating: product.rating || null,
    tags: Array.isArray(product.tags) ? product.tags : [],
    provenance: {
      source: "ucp",
      sourceId: id,
      fetchedAt: clock().toISOString(),
      canonicalUrl: product.url || null,
    },
  };
}

function normalizeMinorMoney(value) {
  const amountMinor = Number(value?.amount);
  const currency = String(value?.currency || "").toUpperCase();
  if (
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 0 ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    return null;
  }
  return { amountMinor, currency };
}

function cartResult(toolName, result, interpreter) {
  const cart = result.structured?.cart || result.resource;
  return {
    toolName,
    response: result,
    cart,
    cartId: cart?.id || null,
    continueUrl: result.continueUrl,
    status: result.status,
    requiresEscalation: result.requiresEscalation,
    messages: result.messages,
    warnings: result.warnings,
    disclosures: result.disclosures,
    businessMessage: interpreter.interpret(cart),
  };
}

function checkoutResult(toolName, cartId, result) {
  const checkout = result.structured?.checkout || result.resource;
  return {
    toolName,
    cartId,
    checkoutId: checkout?.id || null,
    checkout,
    checkoutUrl: result.continueUrl,
    status: result.status,
    requiresEscalation: result.requiresEscalation,
    messages: result.messages,
    warnings: result.warnings,
    disclosures: result.disclosures,
  };
}

function buildFullCartUpdate(cart, variantId, quantity) {
  const existing = Array.isArray(cart?.line_items) ? cart.line_items : [];
  let matched = false;
  const lineItems = existing.map((line) => {
    const id = String(line?.item?.id || "");
    if (id === variantId) {
      matched = true;
      return writeLine(id, Number(line.quantity || 0) + quantity);
    }
    return writeLine(id, Number(line.quantity || 0));
  });
  if (!matched) lineItems.push(writeLine(variantId, quantity));

  return compact({
    line_items: lineItems.filter(
      (line) =>
        line.item.id && Number.isInteger(line.quantity) && line.quantity > 0,
    ),
    context: cart?.context,
    attribution: cart?.attribution,
    buyer: cart?.buyer,
    signals: cart?.signals,
  });
}

function writeLine(variantId, quantity) {
  return { quantity, item: { id: variantId } };
}

function toUcpContext(value = {}) {
  return compact({
    address_country: value.countryCode || value.address_country,
    address_region: value.regionCode || value.address_region,
    postal_code: value.postalCode || value.postal_code,
    language: value.languageCode,
    currency: value.currencyCode,
  });
}

function compact(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined && item !== null)
      .map(([key, item]) => [
        key,
        typeof item === "object" && !Array.isArray(item) ? compact(item) : item,
      ])
      .filter(([, item]) =>
        typeof item === "object" && !Array.isArray(item)
          ? Object.keys(item).length > 0
          : true,
      ),
  );
}

function displayMoney(value) {
  if (!value || value.amount === undefined || value.amount === null) return "";
  const amount = Number(value.amount);
  const currency = String(value.currency || "").toUpperCase();
  const fractionDigits = currencyFractionDigits(currency);
  const display = Number.isFinite(amount)
    ? (amount / 10 ** fractionDigits).toFixed(fractionDigits)
    : String(value.amount);
  return `${currency} ${display}`.trim();
}

function currencyFractionDigits(currency) {
  if (!/^[A-Z]{3}$/.test(currency)) return 2;
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits;
  } catch (_error) {
    return 2;
  }
}

function findContinueUrl(value) {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return findContinueUrl(JSON.parse(value));
    } catch (_error) {
      return /^https:\/\//.test(value) ? value : null;
    }
  }
  if (Array.isArray(value)) {
    return value.map(findContinueUrl).find(Boolean) || null;
  }
  return (
    value.continue_url ||
    value.continueUrl ||
    value.checkoutUrl ||
    value.checkout_url ||
    Object.values(value).map(findContinueUrl).find(Boolean) ||
    null
  );
}

function assertInternalIdempotencyKey(value) {
  if (!/^commerce:v1:[a-f0-9]{64}$/.test(String(value || ""))) {
    throw new CommerceProviderError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid internal commerce idempotency key is required",
      { status: 400 },
    );
  }
}
