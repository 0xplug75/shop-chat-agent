const VALID_WIDGET_POSITIONS = new Set([
  "bottom-right",
  "bottom-left",
  "top-right",
  "top-left"
]);

const VALID_WIDGET_LAYOUTS = new Set([
  "bubble",
  "side-panel",
  "inline",
  "fullscreen"
]);

const VALID_ENTRY_BEHAVIORS = new Set([
  "auto",
  "choice",
  "direct"
]);

const VALID_BUNDLE_STRATEGIES = new Set([
  "none",
  "complementary",
  "starter_kit",
  "frequently_bought_together"
]);

const VALID_BESTSELLER_PRIORITIES = new Set([
  "off",
  "low",
  "medium",
  "high"
]);

const VALID_OUT_OF_STOCK_POLICIES = new Set([
  "hide",
  "explain_and_suggest_alternatives",
  "show_waitlist_message"
]);

/**
 * Validates a merchant configuration object after defaults have been merged.
 * Keep this dependency-free so the same schema shape can move to Supabase later.
 * @param {Object} config - Merged merchant config
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateMerchantConfig(config) {
  const errors = [];

  requireObject(config, "config", errors);
  requireObject(config.assistant, "assistant", errors);
  requireString(config.assistant?.name, "assistant.name", errors);
  requireString(config.assistant?.personality, "assistant.personality", errors);
  requireString(config.assistant?.brandVoice, "assistant.brandVoice", errors);
  requireString(config.assistant?.welcomeMessage, "assistant.welcomeMessage", errors);
  requireStringArray(config.assistant?.quickActions, "assistant.quickActions", errors);

  requireObject(config.widget, "widget", errors);
  requireEnum(config.widget?.position, "widget.position", VALID_WIDGET_POSITIONS, errors);
  requireEnum(config.widget?.layout, "widget.layout", VALID_WIDGET_LAYOUTS, errors);
  requireObject(config.widget?.colors, "widget.colors", errors);
  requireString(config.widget?.colors?.primary, "widget.colors.primary", errors);
  requireString(config.widget?.colors?.background, "widget.colors.background", errors);
  requireString(config.widget?.colors?.text, "widget.colors.text", errors);
  requireString(config.widget?.colors?.accent, "widget.colors.accent", errors);
  requireObject(config.widget?.behavior, "widget.behavior", errors);
  requireBoolean(config.widget?.behavior?.openOnLoad, "widget.behavior.openOnLoad", errors);
  requireBoolean(config.widget?.behavior?.showQuickActions, "widget.behavior.showQuickActions", errors);
  requireEnum(config.widget?.behavior?.entryBehavior, "widget.behavior.entryBehavior", VALID_ENTRY_BEHAVIORS, errors);
  requireBoolean(config.widget?.behavior?.allowFullscreen, "widget.behavior.allowFullscreen", errors);

  requireObject(config.shopping, "shopping", errors);
  requireObject(config.shopping?.recommendationRules, "shopping.recommendationRules", errors);
  requireNumber(config.shopping?.recommendationRules?.maxProducts, "shopping.recommendationRules.maxProducts", errors);
  requireBoolean(config.shopping?.recommendationRules?.requireVariantConfirmation, "shopping.recommendationRules.requireVariantConfirmation", errors);
  requireBoolean(config.shopping?.recommendationRules?.preferAvailableInventory, "shopping.recommendationRules.preferAvailableInventory", errors);
  requireEnum(config.shopping?.bundleStrategy, "shopping.bundleStrategy", VALID_BUNDLE_STRATEGIES, errors);
  requireEnum(config.shopping?.bestsellerPriority, "shopping.bestsellerPriority", VALID_BESTSELLER_PRIORITIES, errors);
  requireEnum(config.shopping?.outOfStockPolicy, "shopping.outOfStockPolicy", VALID_OUT_OF_STOCK_POLICIES, errors);

  requireObject(config.analytics, "analytics", errors);
  requireBoolean(config.analytics?.enabled, "analytics.enabled", errors);
  requireStringArray(config.analytics?.events, "analytics.events", errors);

  requireObject(config.integrations, "integrations", errors);
  for (const integrationName of ["klaviyo", "posthog", "ga4", "make", "n8n"]) {
    requireObject(config.integrations?.[integrationName], `integrations.${integrationName}`, errors);
    requireBoolean(config.integrations?.[integrationName]?.enabled, `integrations.${integrationName}.enabled`, errors);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function requireObject(value, path, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
  }
}

function requireString(value, path, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function requireBoolean(value, path, errors) {
  if (typeof value !== "boolean") {
    errors.push(`${path} must be a boolean`);
  }
}

function requireNumber(value, path, errors) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${path} must be a finite number`);
  }
}

function requireStringArray(value, path, errors) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    errors.push(`${path} must be an array of non-empty strings`);
  }
}

function requireEnum(value, path, allowedValues, errors) {
  if (!allowedValues.has(value)) {
    errors.push(`${path} must be one of: ${Array.from(allowedValues).join(", ")}`);
  }
}
