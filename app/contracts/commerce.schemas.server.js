import { z } from "zod";

export const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export const ShopDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(255)
  .regex(SHOP_DOMAIN_PATTERN, "Expected a canonical *.myshopify.com domain");

export const ConversationIdSchema = z.string().uuid();

export const ChatRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(2000),
    conversation_id: ConversationIdSchema.nullish(),
    visitor_id: ConversationIdSchema.nullish(),
    prompt_type: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .optional(),
  })
  .strict();

export const HistoryQuerySchema = z.object({
  conversation_id: ConversationIdSchema,
});

export const WidgetTokenPayloadSchema = z
  .object({
    version: z.literal(2),
    shopId: z.string().min(1).max(128),
    shopDomain: ShopDomainSchema,
    storefrontOrigin: z.string().url().max(2048).nullable(),
    visitorId: ConversationIdSchema,
    issuedAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
    tokenId: z.string().uuid(),
  })
  .strict();

export const OAuthCallbackQuerySchema = z.object({
  code: z.string().min(1).max(4096),
  state: z.string().min(32).max(512),
});

export const JourneyStageSchema = z.enum([
  "DISCOVER",
  "COMPARE",
  "CONFIRM",
  "CART",
  "CHECKOUT",
  "COMPLETED",
  "ABANDONED",
  "EXPIRED",
]);

const BudgetSchema = z
  .object({
    min: z.number().nonnegative().nullable(),
    max: z.number().nonnegative().nullable(),
    currency: z.string().trim().length(3).toUpperCase().nullable(),
  })
  .strict();

const ContractVersionSchema = z.literal("1.0");

export const MerchantContextSchema = z
  .object({
    version: ContractVersionSchema,
    shopId: z.string().trim().min(1).max(128),
    shopDomain: ShopDomainSchema,
    storefrontOrigin: z.string().url().max(2048).nullable(),
    requestId: z.string().uuid(),
    conversationId: ConversationIdSchema.nullable(),
  })
  .strict();

export const BuyerContextSchema = z
  .object({
    version: ContractVersionSchema,
    visitorId: ConversationIdSchema.nullable(),
    customerId: z.string().trim().min(1).max(255).nullable(),
    countryCode: z.string().trim().length(2).toUpperCase().nullable(),
    languageCode: z.string().trim().min(2).max(35).nullable(),
    currencyCode: z.string().trim().length(3).toUpperCase().nullable(),
    consent: z
      .object({
        personalization: z.boolean(),
        recovery: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const VerticalPackSchema = z
  .object({
    version: ContractVersionSchema,
    id: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    displayName: z.string().trim().min(1).max(120),
    status: z.enum(["active", "inactive", "shadow"]),
    capabilities: z.array(z.string().trim().min(1).max(160)).max(50),
    configuration: z.record(z.string(), z.unknown()),
    provenance: z
      .object({
        owner: z.string().trim().min(1).max(120),
        source: z.string().trim().min(1).max(2048),
        updatedAt: z.string().datetime(),
      })
      .strict(),
  })
  .strict();

export const ProductTrustSchema = z
  .object({
    version: ContractVersionSchema,
    source: z.enum(["shopify", "ucp", "merchant", "fixture"]),
    sourceId: z.string().trim().min(1).max(255),
    fetchedAt: z.string().datetime(),
    canonicalUrl: z.string().url().max(2048).nullable(),
    evidence: z.array(z.string().trim().min(1).max(500)).max(20),
  })
  .strict();

const NormalizedVariantSchema = z
  .object({
    id: z.string().trim().min(1).max(255),
    title: z.string().trim().max(255),
    available: z.boolean().nullable(),
    price: z
      .object({
        amount: z.string().trim().min(1).max(64),
        currencyCode: z.string().trim().length(3).toUpperCase(),
      })
      .strict()
      .nullable(),
    selectedOptions: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            value: z.string().trim().min(1).max(255),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

export const NormalizedProductSchema = z
  .object({
    version: ContractVersionSchema,
    id: z.string().trim().min(1).max(255),
    handle: z.string().trim().max(255).nullable(),
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().max(12000),
    canonicalUrl: z.string().url().max(2048).nullable(),
    imageUrl: z.string().url().max(2048).nullable(),
    available: z.boolean().nullable(),
    variants: z.array(NormalizedVariantSchema).max(250),
    trust: ProductTrustSchema,
    attributes: z.record(z.string(), z.unknown()),
  })
  .strict();

export const RecommendationSetSchema = z
  .object({
    version: ContractVersionSchema,
    id: z.string().uuid(),
    intentRevision: z.number().int().nonnegative(),
    products: z.array(NormalizedProductSchema).min(1).max(3),
    rationale: z.string().trim().min(1).max(2000),
    tradeoffs: z.array(z.string().trim().min(1).max(500)).max(12),
    generatedAt: z.string().datetime(),
  })
  .strict();

export const ExperienceDocumentSchema = z
  .object({
    version: ContractVersionSchema,
    id: z.string().uuid(),
    surface: z.enum(["widget", "inline", "fullscreen", "external_agent"]),
    state: z.enum([
      "welcome",
      "clarification",
      "recommendations",
      "comparison",
      "confirmation",
      "cart",
      "checkout",
      "error",
    ]),
    blocks: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(128),
            type: z.string().trim().min(1).max(80),
            data: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .max(50),
    actions: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(128),
            type: z.string().trim().min(1).max(80),
            label: z.string().trim().min(1).max(160),
            payload: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();

export const ExperimentAssignmentSchema = z
  .object({
    version: ContractVersionSchema,
    id: z.string().min(1).max(128),
    experimentKey: z.string().trim().min(1).max(120),
    variant: z.string().trim().min(1).max(80),
    visitorId: ConversationIdSchema,
    assignedAt: z.string().datetime(),
    exposedAt: z.string().datetime().nullable(),
  })
  .strict();

export const BehaviorSignalSchema = z
  .object({
    version: ContractVersionSchema,
    eventName: z.string().trim().min(1).max(120),
    shopId: z.string().trim().min(1).max(128),
    visitorId: ConversationIdSchema.nullable(),
    conversationId: ConversationIdSchema.nullable(),
    experimentKey: z.string().trim().min(1).max(120).nullable(),
    variant: z.string().trim().min(1).max(80).nullable(),
    payload: z.record(z.string(), z.unknown()),
    occurredAt: z.string().datetime(),
  })
  .strict();

export const RecoveryStateSchema = z
  .object({
    version: ContractVersionSchema,
    status: z.enum([
      "available",
      "restored",
      "consumed",
      "expired",
      "disabled",
    ]),
    intent: z.record(z.string(), z.unknown()).nullable(),
    recommendations: z.array(z.record(z.string(), z.unknown())).max(3),
    cartCandidate: z.record(z.string(), z.unknown()).nullable(),
    cartId: z.string().trim().min(1).max(512).nullable(),
    checkoutUrl: z.string().url().max(2048).nullable(),
    savedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export const ShoppingIntentSchema = z
  .object({
    goal: z.enum([
      "discover",
      "compare",
      "product_question",
      "policy_question",
      "select_product",
      "select_variant",
      "update_cart",
      "checkout",
      "support",
      "unknown",
    ]),
    category: z.string().trim().max(160).nullable(),
    useCase: z.string().trim().max(500).nullable(),
    budget: BudgetSchema,
    attributes: z.record(z.string(), z.unknown()),
    preferences: z.array(z.string().trim().min(1).max(160)).max(30),
    exclusions: z.array(z.string().trim().min(1).max(160)).max(30),
    requestedProductIds: z.array(z.string().trim().min(1).max(255)).max(20),
    confidence: z.number().min(0).max(1),
    missingInformation: z.array(z.string().trim().min(1).max(160)).max(20),
  })
  .strict();

export const IntentEvidenceSchema = z
  .object({
    source: z.enum(["shopper", "merchant", "shopify", "system"]),
    field: z.string().trim().min(1).max(160),
    value: z.unknown(),
    observedAt: z.string().datetime(),
  })
  .strict();

export const IntentStateSchema = ShoppingIntentSchema.extend({
  version: ContractVersionSchema,
  revision: z.number().int().nonnegative(),
  constraints: z.record(z.string(), z.unknown()),
  evidence: z.array(IntentEvidenceSchema).max(100),
}).strict();

export const CatalogSearchRequestSchema = z
  .object({
    version: ContractVersionSchema,
    merchant: z
      .object({
        shopId: z.string().trim().min(1).max(128),
      })
      .strict(),
    buyer: z
      .object({
        countryCode: z.string().trim().length(2).toUpperCase().nullable(),
        languageCode: z.string().trim().min(2).max(35).nullable(),
      })
      .strict(),
    vertical: z.string().trim().min(1).max(128).nullable(),
    intent: IntentStateSchema,
    filters: z
      .object({
        hard: z.record(z.string(), z.unknown()),
        soft: z.record(z.string(), z.unknown()),
      })
      .strict(),
    signals: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(128),
            value: z.unknown(),
          })
          .strict(),
      )
      .max(50),
    pagination: z
      .object({
        cursor: z.string().trim().min(1).max(1024).nullable(),
      })
      .strict(),
    limit: z.number().int().min(1).max(3),
  })
  .strict();

export const PurchaseCandidateSchema = z
  .object({
    version: ContractVersionSchema,
    confirmationId: z.string().uuid(),
    selectionRevision: z.number().int().positive(),
    productId: z.string().trim().min(1).max(255),
    variantId: z.string().trim().min(1).max(255),
    quantity: z.number().int().min(1).max(99),
    cartId: z.string().trim().min(1).max(512).nullable(),
    confirmedAt: z.string().datetime(),
  })
  .strict();

// CartCandidate is the product-facing name. PurchaseCandidate remains as a
// compatibility export for existing runtime callers.
export const CartCandidateSchema = PurchaseCandidateSchema;

export const CommerceSessionContractSchema = z
  .object({
    version: ContractVersionSchema,
    id: z.string().trim().min(1).max(128),
    shopId: z.string().trim().min(1).max(128),
    conversationId: ConversationIdSchema,
    stage: JourneyStageSchema,
    intent: IntentStateSchema.nullable(),
    recommendations: RecommendationSetSchema.nullable(),
    cartCandidate: CartCandidateSchema.nullable(),
    cart: z.record(z.string(), z.unknown()).nullable(),
    recovery: RecoveryStateSchema.nullable(),
    experiment: ExperimentAssignmentSchema.nullable(),
    expiresAt: z.string().datetime(),
    revision: z.number().int().positive(),
  })
  .strict();

export const CartSnapshotSchema = z
  .object({
    version: ContractVersionSchema,
    provider: z.enum(["shopify", "ucp", "fixture"]),
    cartId: z.string().trim().min(1).max(512),
    checkoutUrl: z.string().url().max(2048).nullable(),
    lines: z
      .array(
        z
          .object({
            lineId: z.string().trim().min(1).max(512).nullable(),
            productId: z.string().trim().min(1).max(255),
            variantId: z.string().trim().min(1).max(255),
            quantity: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(250),
    cost: z
      .object({
        subtotal: z.number().nonnegative().nullable(),
        total: z.number().nonnegative().nullable(),
        currency: z.string().trim().length(3).toUpperCase().nullable(),
      })
      .strict(),
    providerUpdatedAt: z.string().datetime(),
  })
  .strict();

export const CatalogSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    category: z.string().trim().max(160).nullable().optional(),
    filters: z.record(z.string(), z.unknown()).default({}),
    budget: BudgetSchema.optional(),
    availability: z.enum(["available", "any"]).default("available"),
    limit: z.number().int().min(1).max(3).default(3),
  })
  .strict();

export const SearchCatalogInputSchema = CatalogSearchInputSchema;

export const ProductDetailsInputSchema = z
  .object({
    productId: z.string().trim().min(1).max(255),
  })
  .strict();

export const KnowledgeSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    limit: z.number().int().min(1).max(8).default(5),
    maxCharacters: z.number().int().min(500).max(12000).default(6000),
  })
  .strict();

export const CompareProductsInputSchema = z
  .object({
    productIds: z.array(z.string().trim().min(1).max(255)).min(2).max(3),
    criteria: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
  })
  .strict();

export const GetCartInputSchema = z
  .object({
    cartId: z.string().trim().min(1).max(512),
  })
  .strict();

export const UpdateCartInputSchema = z
  .object({
    cartId: z.string().trim().min(1).max(512).nullable().optional(),
    productId: z.string().trim().min(1).max(255),
    variantId: z.string().trim().min(1).max(255),
    quantity: z.number().int().min(1).max(99),
    confirmed: z.literal(true),
  })
  .strict();

export const CheckoutHandoffInputSchema = z
  .object({
    cartId: z.string().trim().min(1).max(512),
  })
  .strict();

export function formatZodError(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
