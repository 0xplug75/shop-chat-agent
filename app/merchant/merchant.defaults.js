/**
 * Default merchant configuration.
 * These values are merged with the merchant editable config at runtime.
 */
export const merchantDefaults = {
  assistant: {
    name: "Sage",
    personality: "helpful, concise, and commerce-focused",
    brandVoice: "friendly, clear, and grounded in real product data",
    welcomeMessage: "Hi, I can help you find the right product.",
    quickActions: ["Find the right product", "Compare options", "Ready to buy"],
    providerPreference: "auto",
  },
  widget: {
    position: "bottom-right",
    layout: "bubble",
    colors: {
      primary: "#4f46e5",
      background: "#ffffff",
      text: "#111827",
      accent: "#a78bfa",
    },
    behavior: {
      openOnLoad: false,
      showQuickActions: true,
      entryBehavior: "auto",
      allowFullscreen: true,
      maxProactivePerSession: 1,
    },
  },
  knowledge: {
    shopifyCatalogEnabled: true,
    policiesEnabled: true,
    approvedDocumentsEnabled: false,
    activeVerticals: [],
    provenanceRequired: true,
  },
  shopping: {
    recommendationRules: {
      maxProducts: 3,
      requireVariantConfirmation: true,
      preferAvailableInventory: true,
    },
    bundleStrategy: "none",
    bestsellerPriority: "medium",
    outOfStockPolicy: "explain_and_suggest_alternatives",
    commerceProvider: "shopify",
    checkoutStrategy: "shopify_handoff",
    ucp: {
      businessUrl: null,
      cartEnabled: true,
      checkoutEnabled: false,
      completeEnabled: false,
    },
    recovery: {
      enabled: true,
      ttlHours: 24,
    },
    featureFlags: {
      ucpCart: true,
      ucpCheckout: false,
      sessionRecovery: true,
      contextualLauncher: false,
    },
  },
  experiments: {
    killSwitch: false,
    launcherEntry: {
      enabled: false,
      treatmentPercentage: 50,
    },
  },
  analytics: {
    enabled: true,
    events: [
      "widget_opened",
      "message_sent",
      "catalog_searched",
      "products_recommended",
      "variant_selected",
      "cart_updated",
      "checkout_opened",
    ],
  },
  integrations: {
    klaviyo: {
      enabled: false,
    },
    posthog: {
      enabled: false,
    },
    ga4: {
      enabled: false,
    },
    make: {
      enabled: false,
      webhookUrl: "",
    },
    n8n: {
      enabled: false,
      webhookUrl: "",
    },
  },
};
