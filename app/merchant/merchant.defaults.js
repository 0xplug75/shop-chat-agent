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
    quickActions: [
      "Find the right product",
      "Compare options",
      "Ready to buy"
    ]
  },
  widget: {
    position: "bottom-right",
    layout: "bubble",
    colors: {
      primary: "#4f46e5",
      background: "#ffffff",
      text: "#111827",
      accent: "#a78bfa"
    },
    behavior: {
      openOnLoad: false,
      showQuickActions: true,
      entryBehavior: "auto",
      allowFullscreen: true
    }
  },
  shopping: {
    recommendationRules: {
      maxProducts: 3,
      requireVariantConfirmation: true,
      preferAvailableInventory: true
    },
    bundleStrategy: "none",
    bestsellerPriority: "medium",
    outOfStockPolicy: "explain_and_suggest_alternatives"
  },
  analytics: {
    enabled: true,
    events: [
      "widget_opened",
      "message_sent",
      "catalog_searched",
      "product_recommended",
      "variant_selected",
      "cart_updated",
      "checkout_clicked"
    ]
  },
  integrations: {
    klaviyo: {
      enabled: false
    },
    posthog: {
      enabled: false
    },
    ga4: {
      enabled: false
    },
    make: {
      enabled: false,
      webhookUrl: ""
    },
    n8n: {
      enabled: false,
      webhookUrl: ""
    }
  }
};
