import { randomUUID } from "node:crypto";
import {
  ExperienceDocumentSchema,
  NormalizedProductSchema,
  RecommendationSetSchema,
} from "../contracts/commerce.schemas.server";

const MAX_RECOMMENDATIONS = 3;

export function buildExperienceDocument({
  context,
  merchantConfig,
  session,
  intent,
  assistantText,
  products = [],
  confirmationRequired = null,
  cartState = null,
  providerId = "shopify",
  clock = () => new Date(),
  idFactory = randomUUID,
}) {
  const generatedAt = clock().toISOString();
  const normalizedProducts = products
    .map((product) =>
      normalizeExperienceProduct(product, {
        context,
        providerId,
        generatedAt,
      }),
    )
    .filter(Boolean)
    .slice(0, MAX_RECOMMENDATIONS);
  const recommendations = normalizedProducts.length
    ? RecommendationSetSchema.parse({
        version: "1.0",
        id: idFactory(),
        intentRevision: Math.max(0, Number(session?.version || 0)),
        products: normalizedProducts,
        rationale:
          boundedText(assistantText, 2000) ||
          "Recommendations from the current merchant catalog.",
        tradeoffs: [],
        generatedAt,
      })
    : null;
  const state = resolveExperienceState({
    session,
    intent,
    recommendations,
    confirmationRequired,
    cartState,
  });
  const blocks = [
    {
      id: "assistant-message",
      type: "message",
      data: { text: boundedText(assistantText, 12000) },
    },
  ];
  const actions = [];

  if (recommendations) {
    blocks.push({
      id: "recommendations",
      type: "recommendation_set",
      data: { recommendations },
    });
    for (const [index, product] of recommendations.products.entries()) {
      actions.push({
        id: `select-product-${index + 1}`,
        type: "select_product",
        label: `Select ${product.title}`.slice(0, 160),
        payload: { productId: product.id },
      });
    }
    if (recommendations.products.length > 1) {
      actions.push({
        id: "compare-recommendations",
        type: "compare_products",
        label: "Compare options",
        payload: {
          productIds: recommendations.products.map((product) => product.id),
        },
      });
    }
  }

  if (
    Array.isArray(session?.comparedProducts) &&
    session.comparedProducts.length
  ) {
    blocks.push({
      id: "comparison",
      type: "comparison",
      data: {
        products: session.comparedProducts.slice(0, MAX_RECOMMENDATIONS),
      },
    });
  }

  if (confirmationRequired) {
    blocks.push({
      id: "cart-confirmation",
      type: "cart_confirmation",
      data: { candidate: confirmationRequired },
    });
    actions.push({
      id: "confirm-cart-candidate",
      type: "confirm_cart_candidate",
      label: "Confirm selection",
      payload: { confirmationId: confirmationRequired.confirmationId },
    });
  }

  if (cartState) {
    blocks.push({
      id: "cart",
      type: "cart",
      data: {
        cartId: cartState.cartId || null,
        checkoutUrl: safeUrl(cartState.checkoutUrl, context?.storefrontOrigin),
      },
    });
    const checkoutUrl = safeUrl(
      cartState.checkoutUrl,
      context?.storefrontOrigin,
    );
    if (checkoutUrl) {
      actions.push({
        id: "open-shopify-checkout",
        type: "open_checkout",
        label: "Continue to checkout",
        payload: { checkoutUrl },
      });
    }
  }

  const document = ExperienceDocumentSchema.parse({
    version: "1.0",
    id: idFactory(),
    surface: surfaceForLayout(merchantConfig?.widget?.layout),
    state,
    blocks,
    actions,
  });

  return { document, recommendations };
}

export function normalizeExperienceProduct(
  product,
  { context, providerId, generatedAt },
) {
  const id = boundedText(product?.id || product?.product_id, 255);
  const title = boundedText(product?.title, 500);
  if (!id || !title) return null;

  const source = normalizeSource(product?.provenance?.source, providerId);
  const canonicalUrl = safeUrl(
    product?.url || product?.canonicalUrl,
    context?.storefrontOrigin,
  );
  const parsed = NormalizedProductSchema.safeParse({
    version: "1.0",
    id,
    handle:
      boundedText(product?.handle, 255) || handleFromUrl(canonicalUrl) || null,
    title,
    description: boundedText(product?.description, 12000),
    canonicalUrl,
    imageUrl: safeUrl(
      product?.image_url || product?.imageUrl,
      context?.storefrontOrigin,
    ),
    available:
      typeof product?.available === "boolean" ? product.available : null,
    variants: normalizeVariants(product),
    trust: {
      version: "1.0",
      source,
      sourceId: boundedText(product?.provenance?.sourceId || id, 255),
      fetchedAt: product?.provenance?.fetchedAt || generatedAt,
      canonicalUrl,
      evidence: [
        source === "fixture"
          ? "Deterministic test fixture"
          : "Current commerce provider response",
      ],
    },
    attributes: {
      rating: product?.rating ?? null,
      tags: Array.isArray(product?.tags) ? product.tags.slice(0, 50) : [],
      options: Array.isArray(product?.options)
        ? product.options.slice(0, 30)
        : [],
    },
  });
  return parsed.success ? parsed.data : null;
}

export function resolveExperienceState({
  session,
  intent,
  recommendations,
  confirmationRequired,
  cartState,
}) {
  if (session?.journeyStage === "CHECKOUT" || cartState?.checkoutUrl) {
    return "checkout";
  }
  if (session?.journeyStage === "CART" || cartState?.cartId) return "cart";
  if (confirmationRequired || session?.journeyStage === "CONFIRM") {
    return "confirmation";
  }
  if (
    Array.isArray(session?.comparedProducts) &&
    session.comparedProducts.length
  ) {
    return "comparison";
  }
  if (recommendations) return "recommendations";
  if (intent?.missingInformation?.length) return "clarification";
  return "welcome";
}

function normalizeVariants(product) {
  if (!Array.isArray(product?.variants)) return [];
  return product.variants
    .map((variant) => {
      const id = boundedText(variant?.id || variant?.variant_id, 255);
      if (!id) return null;
      return {
        id,
        title: boundedText(variant?.title || variant?.name, 255),
        available:
          typeof variant?.available === "boolean" ? variant.available : null,
        price: normalizeMoney(variant, product),
        selectedOptions: normalizeSelectedOptions(
          variant?.selected_options || variant?.selectedOptions,
        ),
      };
    })
    .filter(Boolean)
    .slice(0, 250);
}

function normalizeMoney(variant, product) {
  const rawPrice = variant?.price;
  const currency = boundedText(
    variant?.currency ||
      rawPrice?.currency ||
      rawPrice?.currencyCode ||
      product?.price_range?.min?.currency ||
      product?.price_range?.min?.currencyCode,
    3,
  ).toUpperCase();
  const rawAmount =
    rawPrice && typeof rawPrice === "object" ? rawPrice.amount : rawPrice;
  if (!currency || currency.length !== 3 || rawAmount == null) return null;
  const amount = boundedText(rawAmount, 64)
    .replace(new RegExp(`^${currency}\\s*`, "i"), "")
    .trim();
  return amount ? { amount, currencyCode: currency } : null;
}

function normalizeSelectedOptions(options) {
  if (!Array.isArray(options)) return [];
  return options
    .map((option) => {
      if (typeof option === "string") {
        const separator = option.indexOf(":");
        return separator > 0
          ? {
              name: option.slice(0, separator).trim(),
              value: option.slice(separator + 1).trim(),
            }
          : { name: "Option", value: option.trim() };
      }
      return {
        name: boundedText(option?.name, 120),
        value: boundedText(option?.value || option?.label, 255),
      };
    })
    .filter((option) => option.name && option.value)
    .slice(0, 20);
}

function normalizeSource(source, providerId) {
  if (["shopify", "ucp", "merchant", "fixture"].includes(source)) {
    return source;
  }
  if (providerId === "ucp" || providerId === "fixture") return providerId;
  return "shopify";
}

function surfaceForLayout(layout) {
  if (layout === "inline") return "inline";
  if (layout === "fullscreen") return "fullscreen";
  return "widget";
}

function handleFromUrl(value) {
  if (!value) return null;
  try {
    const match = new URL(value).pathname.match(/\/products\/([^/]+)/);
    return match?.[1] || null;
  } catch (_error) {
    return null;
  }
}

function safeUrl(value, base) {
  if (!value) return null;
  try {
    const url = new URL(String(value), base || undefined);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch (_error) {
    return null;
  }
}

function boundedText(value, maximum) {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, maximum);
}
