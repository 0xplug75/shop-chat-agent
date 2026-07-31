import { z } from "zod";

const WidgetSchema = z.object({
  position: z.enum(["bottom-right", "bottom-left", "top-right", "top-left"]),
  layout: z.enum(["bubble", "side-panel", "inline", "fullscreen"]),
  colors: z.object({
    primary: z.string().min(1).max(64),
    background: z.string().min(1).max(64),
    text: z.string().min(1).max(64),
    accent: z.string().min(1).max(64)
  }).strict(),
  behavior: z.object({
    openOnLoad: z.boolean(),
    showQuickActions: z.boolean(),
    entryBehavior: z.enum(["auto", "choice", "direct"]),
    allowFullscreen: z.boolean()
  }).strict()
}).strict();

export const MerchantConfigSchema = z.object({
  assistant: z.object({
    name: z.string().trim().min(1).max(80),
    personality: z.string().trim().min(1).max(2000),
    brandVoice: z.string().trim().min(1).max(2000),
    welcomeMessage: z.string().trim().min(1).max(1000),
    quickActions: z.array(z.string().trim().min(1).max(120)).min(1).max(8)
  }).strict(),
  widget: WidgetSchema,
  shopping: z.object({
    recommendationRules: z.object({
      maxProducts: z.number().int().min(1).max(3),
      requireVariantConfirmation: z.boolean(),
      preferAvailableInventory: z.boolean()
    }).strict(),
    bundleStrategy: z.enum([
      "none",
      "complementary",
      "starter_kit",
      "frequently_bought_together"
    ]),
    bestsellerPriority: z.enum(["off", "low", "medium", "high"]),
    outOfStockPolicy: z.enum([
      "hide",
      "explain_and_suggest_alternatives",
      "show_waitlist_message"
    ])
  }).strict(),
  analytics: z.object({
    enabled: z.boolean(),
    events: z.array(z.string().trim().min(1).max(120)).max(100)
  }).strict(),
  integrations: z.record(z.string(), z.object({
    enabled: z.boolean(),
    webhookUrl: z.string().max(2048).optional()
  }).passthrough())
}).strict();

export function parseMerchantConfig(config) {
  return MerchantConfigSchema.parse(config);
}
export function validateMerchantConfig(config) {
  const result = MerchantConfigSchema.safeParse(config);
  return result.success
    ? { valid: true, errors: [] }
    : {
        valid: false,
        errors: result.error.issues.map((issue) =>
          `${issue.path.join(".") || "config"}: ${issue.message}`
        )
      };
}
