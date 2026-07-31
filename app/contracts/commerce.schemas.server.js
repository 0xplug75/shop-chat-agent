import { z } from "zod";

export const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export const ShopDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(255)
  .regex(SHOP_DOMAIN_PATTERN, "Expected a canonical *.myshopify.com domain");

export const ConversationIdSchema = z.string().uuid();

export const ChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  conversation_id: ConversationIdSchema.nullish(),
  visitor_id: ConversationIdSchema.nullish(),
  prompt_type: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional()
}).strict();

export const HistoryQuerySchema = z.object({
  conversation_id: ConversationIdSchema
});

export const WidgetTokenPayloadSchema = z.object({
  version: z.literal(1),
  shopId: z.string().min(1).max(128),
  shopDomain: ShopDomainSchema,
  storefrontOrigin: z.string().url().max(2048).nullable(),
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  tokenId: z.string().uuid()
}).strict();

export const OAuthCallbackQuerySchema = z.object({
  code: z.string().min(1).max(4096),
  state: z.string().min(32).max(512)
});

export const JourneyStageSchema = z.enum([
  "DISCOVER",
  "COMPARE",
  "CONFIRM",
  "CART",
  "CHECKOUT",
  "COMPLETED",
  "ABANDONED",
  "EXPIRED"
]);

const BudgetSchema = z.object({
  min: z.number().nonnegative().nullable(),
  max: z.number().nonnegative().nullable(),
  currency: z.string().trim().length(3).toUpperCase().nullable()
}).strict();

export const ShoppingIntentSchema = z.object({
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
    "unknown"
  ]),
  category: z.string().trim().max(160).nullable(),
  useCase: z.string().trim().max(500).nullable(),
  budget: BudgetSchema,
  attributes: z.record(z.string(), z.unknown()),
  preferences: z.array(z.string().trim().min(1).max(160)).max(30),
  exclusions: z.array(z.string().trim().min(1).max(160)).max(30),
  requestedProductIds: z.array(z.string().trim().min(1).max(255)).max(20),
  confidence: z.number().min(0).max(1),
  missingInformation: z.array(z.string().trim().min(1).max(160)).max(20)
}).strict();

export const SearchCatalogInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  category: z.string().trim().max(160).nullable().optional(),
  filters: z.record(z.string(), z.unknown()).default({}),
  budget: BudgetSchema.optional(),
  availability: z.enum(["available", "any"]).default("available"),
  limit: z.number().int().min(1).max(3).default(3)
}).strict();

export const ProductDetailsInputSchema = z.object({
  productId: z.string().trim().min(1).max(255)
}).strict();

export const KnowledgeSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(8).default(5),
  maxCharacters: z.number().int().min(500).max(12000).default(6000)
}).strict();

export const CompareProductsInputSchema = z.object({
  productIds: z.array(z.string().trim().min(1).max(255)).min(2).max(3),
  criteria: z.array(z.string().trim().min(1).max(160)).max(12).default([])
}).strict();

export const GetCartInputSchema = z.object({
  cartId: z.string().trim().min(1).max(512)
}).strict();

export const UpdateCartInputSchema = z.object({
  cartId: z.string().trim().min(1).max(512).nullable().optional(),
  productId: z.string().trim().min(1).max(255),
  variantId: z.string().trim().min(1).max(255),
  quantity: z.number().int().min(1).max(99),
  confirmed: z.literal(true)
}).strict();

export const CheckoutHandoffInputSchema = z.object({
  cartId: z.string().trim().min(1).max(512)
}).strict();

export function formatZodError(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message
  }));
}
