import { ShoppingIntentSchema } from "../contracts/commerce.schemas.server";

export const INTENT_TYPES = {
  PRODUCT_DISCOVERY: "discover",
  PRODUCT_DETAIL: "product_question",
  POLICY_QUESTION: "policy_question",
  CART_ACTION: "update_cart",
  CHECKOUT_ACTION: "checkout",
  COMPARE: "compare",
  SELECT_PRODUCT: "select_product",
  SELECT_VARIANT: "select_variant",
  SUPPORT: "support",
  UNKNOWN: "unknown",
};

const TERMS = {
  checkout: [
    "checkout",
    "check out",
    "pay",
    "payment",
    "payer",
    "paiement",
    "commander",
    "finaliser",
    "pagar",
    "pago",
  ],
  cart: [
    "add to cart",
    "cart",
    "basket",
    "panier",
    "ajoute",
    "ajouter",
    "quantité",
    "quantity",
    "carrito",
    "cesta",
  ],
  policy: [
    "shipping",
    "return",
    "refund",
    "policy",
    "delivery",
    "livraison",
    "retour",
    "remboursement",
    "politique",
    "envío",
    "devolución",
  ],
  compare: [
    "compare",
    "comparison",
    "difference",
    "versus",
    " vs ",
    "comparer",
    "comparaison",
    "différence",
    "comparar",
  ],
  variant: [
    "variant",
    "size",
    "color",
    "colour",
    "taille",
    "couleur",
    "pointure",
    "tamaño",
    "color",
  ],
  product: [
    "find",
    "looking for",
    "recommend",
    "best",
    "need",
    "want",
    "show me",
    "cherche",
    "recommande",
    "meilleur",
    "besoin",
    "je veux",
    "montre",
    "buscar",
    "recomienda",
    "necesito",
    "quiero",
  ],
  support: [
    "order status",
    "where is my order",
    "support",
    "help with my order",
    "statut de commande",
    "où est ma commande",
    "service client",
    "estado del pedido",
  ],
};

export function createIntentEngine({ llmGateway } = {}) {
  const classify = async ({ message, session }) => {
    if (llmGateway?.generateStructuredIntent) {
      try {
        const generated = await llmGateway.generateStructuredIntent({
          message,
          session,
        });
        return ShoppingIntentSchema.parse(generated);
      } catch (_error) {
        // The deterministic multilingual classifier keeps the turn available
        // when structured model output is unavailable or invalid.
      }
    }
    return classifyDeterministically(message, session);
  };

  return {
    classify,
    route: ({ message, session }) =>
      classifyDeterministically(message, session),
  };
}

export function createIntentRouter(options) {
  return createIntentEngine(options);
}

export function classifyDeterministically(message, session = {}) {
  const normalized = normalize(message);
  const goal = classifyGoal(normalized, session);
  const budget = extractBudget(normalized, session?.constraints?.budget);
  const preferences = extractListAfterMarkers(normalized, [
    "prefer",
    "with",
    "je préfère",
    "avec",
    "prefiero",
    "con",
  ]);
  const exclusions = extractListAfterMarkers(normalized, [
    "without",
    "avoid",
    "sans",
    "éviter",
    "sin",
    "evitar",
  ]);
  const category = inferCategory(normalized, session?.constraints?.category);
  const missingInformation = [];

  if (goal === "discover" && !category)
    missingInformation.push("category_or_product_type");
  if (goal === "update_cart" && !session?.selectedVariantId)
    missingInformation.push("variant_confirmation");

  return ShoppingIntentSchema.parse({
    goal,
    category,
    useCase: session?.constraints?.useCase || null,
    budget,
    attributes: {},
    preferences,
    exclusions,
    requestedProductIds: [],
    confidence: goal === "unknown" ? 0.35 : 0.72,
    missingInformation,
  });
}

function classifyGoal(message, session) {
  if (matches(message, TERMS.checkout)) return "checkout";
  if (matches(message, TERMS.support)) return "support";
  if (matches(message, TERMS.policy)) return "policy_question";
  if (matches(message, TERMS.compare)) return "compare";
  if (matches(message, TERMS.cart)) return "update_cart";
  if (matches(message, TERMS.variant)) {
    return session?.selectedProductId ? "select_variant" : "product_question";
  }
  if (matches(message, TERMS.product)) return "discover";
  if (session?.journeyStage === "COMPARE") return "product_question";
  return "unknown";
}

function extractBudget(message, previous = {}) {
  const currencyMatch = message.match(
    /(?:€|eur|euros?|\$|usd|dollars?|£|gbp)/i,
  );
  const amountMatch = message.match(
    /(?:under|below|max(?:imum)?|moins de|maximum|hasta|menos de)\s*(?:€|\$|£)?\s*(\d+(?:[.,]\d{1,2})?)/i,
  );
  const rangeMatch = message.match(
    /(\d+(?:[.,]\d{1,2})?)\s*(?:-|to|à|a)\s*(\d+(?:[.,]\d{1,2})?)/i,
  );
  const currency = currencyMatch
    ? normalizeCurrency(currencyMatch[0])
    : previous?.currency || null;

  if (rangeMatch) {
    return {
      min: Number(rangeMatch[1].replace(",", ".")),
      max: Number(rangeMatch[2].replace(",", ".")),
      currency,
    };
  }
  return {
    min: previous?.min ?? null,
    max: amountMatch
      ? Number(amountMatch[1].replace(",", "."))
      : (previous?.max ?? null),
    currency,
  };
}

function inferCategory(message, previous) {
  const categories = [
    "snowboard",
    "shoes",
    "shirt",
    "dress",
    "board",
    "wax",
    "chaussures",
    "chemise",
    "robe",
    "tabla",
    "zapatos",
    "camisa",
  ];
  return (
    categories.find((category) => message.includes(category)) ||
    previous ||
    null
  );
}

function extractListAfterMarkers(message, markers) {
  for (const marker of markers) {
    const index = message.indexOf(marker);
    if (index >= 0) {
      return message
        .slice(index + marker.length)
        .split(/[,;]|\band\b|\bet\b|\by\b/)
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 8);
    }
  }
  return [];
}

function normalizeCurrency(value) {
  const normalized = value.toLowerCase();
  if (normalized.includes("€") || normalized.startsWith("eur")) return "EUR";
  if (normalized.includes("£") || normalized.startsWith("gbp")) return "GBP";
  return "USD";
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function matches(message, terms) {
  return terms.some((term) => message.includes(term));
}
