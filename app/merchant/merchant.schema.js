import { z } from "zod";

const WidgetSchema = z
  .object({
    position: z.enum(["bottom-right", "bottom-left", "top-right", "top-left"]),
    layout: z.enum(["bubble", "side-panel", "inline", "fullscreen"]),
    colors: z
      .object({
        primary: z.string().min(1).max(64),
        background: z.string().min(1).max(64),
        text: z.string().min(1).max(64),
        accent: z.string().min(1).max(64),
      })
      .strict(),
    behavior: z
      .object({
        openOnLoad: z.boolean(),
        showQuickActions: z.boolean(),
        entryBehavior: z.enum(["auto", "choice", "direct"]),
        allowFullscreen: z.boolean(),
        maxProactivePerSession: z.number().int().min(0).max(10),
      })
      .strict(),
  })
  .strict();

export const MerchantConfigSchema = z
  .object({
    assistant: z
      .object({
        name: z.string().trim().min(1).max(80),
        personality: z.string().trim().min(1).max(2000),
        brandVoice: z.string().trim().min(1).max(2000),
        welcomeMessage: z.string().trim().min(1).max(1000),
        quickActions: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
        providerPreference: z.enum(["auto", "openai", "kimi"]),
      })
      .strict(),
    widget: WidgetSchema,
    knowledge: z
      .object({
        shopifyCatalogEnabled: z.literal(true),
        policiesEnabled: z.boolean(),
        approvedDocumentsEnabled: z.boolean(),
        activeVerticals: z
          .array(
            z
              .string()
              .trim()
              .min(1)
              .max(80)
              .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
          )
          .max(20),
        provenanceRequired: z.literal(true),
      })
      .strict(),
    shopping: z
      .object({
        recommendationRules: z
          .object({
            maxProducts: z.number().int().min(1).max(3),
            requireVariantConfirmation: z.literal(true),
            preferAvailableInventory: z.boolean(),
          })
          .strict(),
        bundleStrategy: z.enum([
          "none",
          "complementary",
          "starter_kit",
          "frequently_bought_together",
        ]),
        bestsellerPriority: z.enum(["off", "low", "medium", "high"]),
        outOfStockPolicy: z.enum([
          "hide",
          "explain_and_suggest_alternatives",
          "show_waitlist_message",
        ]),
        commerceProvider: z.enum(["shopify", "ucp"]),
        checkoutStrategy: z.enum(["shopify_handoff", "ucp_handoff"]),
        ucp: z
          .object({
            businessUrl: z.string().url().max(2048).nullable(),
            cartEnabled: z.boolean(),
            checkoutEnabled: z.boolean(),
            completeEnabled: z.literal(false),
          })
          .strict(),
        recovery: z
          .object({
            enabled: z.boolean(),
            ttlHours: z.number().int().min(1).max(168),
          })
          .strict(),
        featureFlags: z.record(z.string(), z.boolean()),
      })
      .strict(),
    experiments: z
      .object({
        killSwitch: z.boolean(),
        launcherEntry: z
          .object({
            enabled: z.boolean(),
            treatmentPercentage: z.number().int().min(0).max(100),
          })
          .strict(),
      })
      .strict(),
    analytics: z
      .object({
        enabled: z.boolean(),
        events: z.array(z.string().trim().min(1).max(120)).max(100),
      })
      .strict(),
    integrations: z.record(
      z.string(),
      z
        .object({
          enabled: z.boolean(),
          webhookUrl: z.string().max(2048).optional(),
        })
        .passthrough(),
    ),
  })
  .strict();

export function parseMerchantConfig(config) {
  return MerchantConfigSchema.parse(config);
}
export function validateMerchantConfig(config) {
  const result = MerchantConfigSchema.safeParse(config);
  return result.success
    ? { valid: true, errors: [] }
    : {
        valid: false,
        errors: result.error.issues.map(
          (issue) => `${issue.path.join(".") || "config"}: ${issue.message}`,
        ),
      };
}
