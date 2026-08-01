import prisma from "../db.server";
import { createMerchantRequestContext } from "../security/merchant-context.server";
import { getOrCreateShop } from "../services/shop.server";
import { appApiKey, authenticate } from "../shopify.server";
import {
  getMerchantConfigSnapshot,
  MerchantConfigVersionConflictError,
  updateMerchantConfig,
} from "./merchant.server";

const SECTION_NAMES = new Set(["assistant", "widget", "knowledge", "commerce"]);

export async function loadIntentCartDashboard(request) {
  const resolved = await resolveDashboardRequest(request);
  const {
    config: merchantConfig,
    version,
    updatedAt,
  } = await getMerchantConfigSnapshot(resolved.context);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [
    activeSessions,
    conversations,
    checkouts,
    knowledgeSources,
    offlineSession,
  ] = await Promise.all([
    prisma.commerceSession.count({
      where: {
        shopId: resolved.shop.id,
        expiresAt: { gt: new Date() },
        journeyStage: { notIn: ["COMPLETED", "ABANDONED", "EXPIRED"] },
      },
    }),
    prisma.conversation.count({
      where: { shopId: resolved.shop.id, createdAt: { gte: since } },
    }),
    prisma.commerceEvent.count({
      where: {
        shopId: resolved.shop.id,
        eventType: "checkout_opened",
        occurredAt: { gte: since },
      },
    }),
    prisma.knowledgeSource.findMany({
      where: { shopId: resolved.shop.id },
      select: { type: true, name: true, status: true, lastSyncedAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.session.findFirst({
      where: {
        shop: resolved.shop.shopDomain,
        isOnline: false,
        revokedAt: null,
      },
      select: { id: true, expires: true, refreshTokenExpires: true },
      orderBy: { lastRefreshAt: "desc" },
    }),
  ]);
  const configuredProviders = configuredLlmProviders();

  return {
    version,
    updatedAt,
    assistant: merchantConfig.assistant,
    storefront: merchantConfig.widget,
    knowledge: {
      ...merchantConfig.knowledge,
      sources: knowledgeSources,
      activeSourceCount:
        1 +
        Number(merchantConfig.knowledge.policiesEnabled) +
        Number(merchantConfig.knowledge.approvedDocumentsEnabled),
    },
    commerce: {
      ...merchantConfig.shopping,
      maxProducts: merchantConfig.shopping.recommendationRules.maxProducts,
      requireVariantConfirmation:
        merchantConfig.shopping.recommendationRules.requireVariantConfirmation,
      preferAvailableInventory:
        merchantConfig.shopping.recommendationRules.preferAvailableInventory,
    },
    experiments: merchantConfig.experiments,
    health: {
      database: "connected",
      shopifyAuth: offlineSession ? "connected" : "attention",
      llm: configuredProviders.length > 0 ? "configured" : "attention",
      llmProviders: configuredProviders,
      ucp:
        merchantConfig.shopping.featureFlags.ucpCart &&
        merchantConfig.shopping.ucp.cartEnabled
          ? "enabled"
          : "disabled",
    },
    metrics: {
      activeSessions,
      conversationsLast30Days: conversations,
      checkoutHandoffsLast30Days: checkouts,
    },
    links: resolved.links,
  };
}

export async function saveIntentCartDashboardSection(request, section) {
  if (!SECTION_NAMES.has(section)) {
    return Response.json(
      { ok: false, error: "Unknown settings section." },
      { status: 404 },
    );
  }

  try {
    const resolved = await resolveDashboardRequest(request);
    const form = await request.formData();
    const snapshot = await getMerchantConfigSnapshot(resolved.context);
    const expectedVersion = integerField(form, "version", { min: 1 });
    const next = structuredClone(snapshot.config);

    if (section === "assistant") applyAssistantForm(next, form);
    if (section === "widget") applyWidgetForm(next, form);
    if (section === "knowledge") applyKnowledgeForm(next, form);
    if (section === "commerce") applyCommerceForm(next, form);

    const saved = await updateMerchantConfig(
      resolved.context,
      next,
      expectedVersion,
    );
    return Response.json({
      ok: true,
      message: "Settings saved.",
      section,
      version: expectedVersion + 1,
      saved,
    });
  } catch (error) {
    const conflict = error instanceof MerchantConfigVersionConflictError;
    return Response.json(
      {
        ok: false,
        error: conflict
          ? "These settings changed in another session. Reload before saving again."
          : publicValidationMessage(error),
      },
      { status: conflict ? 409 : Number(error.status || 400) },
    );
  }
}

async function resolveDashboardRequest(request) {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop({
    shopDomain: session.shop,
    storefrontOrigin: `https://${session.shop}`,
  });
  const context = createMerchantRequestContext({
    shopId: shop.id,
    shopDomain: shop.shopDomain,
  });
  const shopHandle = session.shop.replace(/\.myshopify\.com$/i, "");
  const activationId = appApiKey
    ? `&activateAppId=${encodeURIComponent(`${appApiKey}/chat-interface`)}`
    : "";

  return {
    context,
    shop,
    links: {
      themeEditor: `https://${session.shop}/admin/themes/current/editor?context=apps${activationId}`,
      storefront: `https://${session.shop}`,
      adminProducts: `https://admin.shopify.com/store/${shopHandle}/products`,
    },
  };
}

function applyAssistantForm(config, form) {
  config.assistant = {
    ...config.assistant,
    name: textField(form, "name", { max: 80 }),
    personality: textField(form, "personality", { max: 2000 }),
    brandVoice: textField(form, "brandVoice", { max: 2000 }),
    welcomeMessage: textField(form, "welcomeMessage", { max: 1000 }),
    quickActions: listField(form, "quickActions", { min: 1, max: 8 }),
    providerPreference: enumField(form, "providerPreference", [
      "auto",
      "openai",
      "kimi",
    ]),
  };
}

function applyWidgetForm(config, form) {
  config.widget = {
    ...config.widget,
    layout: enumField(form, "layout", [
      "bubble",
      "side-panel",
      "inline",
      "fullscreen",
    ]),
    behavior: {
      ...config.widget.behavior,
      openOnLoad: checkbox(form, "openOnLoad"),
      showQuickActions: checkbox(form, "showQuickActions"),
      entryBehavior: enumField(form, "entryBehavior", [
        "auto",
        "choice",
        "direct",
      ]),
      allowFullscreen: checkbox(form, "allowFullscreen"),
      maxProactivePerSession: integerField(form, "maxProactivePerSession", {
        min: 0,
        max: 10,
      }),
    },
  };
  config.shopping.featureFlags.contextualLauncher = checkbox(
    form,
    "contextualLauncher",
  );
  config.experiments = {
    killSwitch: checkbox(form, "experimentKillSwitch"),
    launcherEntry: {
      enabled: checkbox(form, "launcherExperimentEnabled"),
      treatmentPercentage: integerField(form, "treatmentPercentage", {
        min: 0,
        max: 100,
      }),
    },
  };
}

function applyKnowledgeForm(config, form) {
  config.knowledge = {
    ...config.knowledge,
    shopifyCatalogEnabled: true,
    policiesEnabled: checkbox(form, "policiesEnabled"),
    approvedDocumentsEnabled: checkbox(form, "approvedDocumentsEnabled"),
    activeVerticals: listField(form, "activeVerticals", {
      min: 0,
      max: 20,
      normalize: (value) => value.toLowerCase().replace(/\s+/g, "-"),
    }),
    provenanceRequired: true,
  };
}

function applyCommerceForm(config, form) {
  const commerceProvider = enumField(form, "commerceProvider", [
    "shopify",
    "ucp",
  ]);
  const checkoutStrategy = enumField(form, "checkoutStrategy", [
    "shopify_handoff",
    "ucp_handoff",
  ]);
  const businessUrl = optionalUrlField(form, "ucpBusinessUrl");
  const cartEnabled = checkbox(form, "ucpCartEnabled");
  const checkoutEnabled = checkbox(form, "ucpCheckoutEnabled");

  if (commerceProvider === "ucp" && !businessUrl) {
    throw new FormValidationError(
      "A verified UCP business URL is required for the external UCP provider.",
    );
  }
  if (checkoutStrategy === "ucp_handoff" && !checkoutEnabled) {
    throw new FormValidationError(
      "Enable UCP checkout before selecting the UCP checkout handoff.",
    );
  }

  config.shopping = {
    ...config.shopping,
    recommendationRules: {
      maxProducts: integerField(form, "maxProducts", { min: 1, max: 3 }),
      requireVariantConfirmation: true,
      preferAvailableInventory: checkbox(form, "preferAvailableInventory"),
    },
    bundleStrategy: enumField(form, "bundleStrategy", [
      "none",
      "complementary",
      "starter_kit",
      "frequently_bought_together",
    ]),
    bestsellerPriority: enumField(form, "bestsellerPriority", [
      "off",
      "low",
      "medium",
      "high",
    ]),
    outOfStockPolicy: enumField(form, "outOfStockPolicy", [
      "hide",
      "explain_and_suggest_alternatives",
      "show_waitlist_message",
    ]),
    commerceProvider,
    checkoutStrategy,
    ucp: {
      businessUrl,
      cartEnabled,
      checkoutEnabled,
      completeEnabled: false,
    },
    recovery: {
      enabled: checkbox(form, "recoveryEnabled"),
      ttlHours: integerField(form, "recoveryTtlHours", { min: 1, max: 168 }),
    },
    featureFlags: {
      ...config.shopping.featureFlags,
      ucpCart: cartEnabled,
      ucpCheckout: checkoutEnabled,
      sessionRecovery: checkbox(form, "recoveryEnabled"),
    },
  };
}

function configuredLlmProviders() {
  return [
    process.env.OPENAI_API_KEY ? "OpenAI" : null,
    process.env.KIMI_API_KEY ? "Kimi" : null,
  ].filter(Boolean);
}

function textField(form, name, { max = 2000 } = {}) {
  const value = String(form.get(name) || "").trim();
  if (!value || value.length > max) {
    throw new FormValidationError(
      `${name} is required and must be at most ${max} characters.`,
    );
  }
  return value;
}

function listField(
  form,
  name,
  { min = 0, max, normalize = (value) => value } = {},
) {
  const values = String(form.get(name) || "")
    .split(/[\n,]/)
    .map((value) => normalize(value.trim()))
    .filter(Boolean);
  const unique = [...new Set(values)];
  if (unique.length < min || unique.length > max) {
    throw new FormValidationError(
      `${name} must contain between ${min} and ${max} values.`,
    );
  }
  return unique;
}

function integerField(form, name, { min, max = Number.MAX_SAFE_INTEGER }) {
  const value = Number(form.get(name));
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new FormValidationError(
      `${name} must be an integer between ${min} and ${max}.`,
    );
  }
  return value;
}

function enumField(form, name, values) {
  const value = String(form.get(name) || "");
  if (!values.includes(value)) {
    throw new FormValidationError(`${name} contains an unsupported value.`);
  }
  return value;
}

function optionalUrlField(form, name) {
  const value = String(form.get(name) || "").trim();
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch (_error) {
    throw new FormValidationError(`${name} must be a valid HTTPS URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new FormValidationError(
      `${name} must be a credential-free HTTPS URL.`,
    );
  }
  return url.toString().replace(/\/$/, "");
}

function checkbox(form, name) {
  return form.get(name) === "on" || form.get(name) === "true";
}

function publicValidationMessage(error) {
  if (error instanceof FormValidationError) return error.message;
  if (Array.isArray(error?.issues) && error.issues[0]?.message) {
    return `Invalid settings: ${error.issues[0].message}`;
  }
  return "The settings could not be saved. Check the fields and try again.";
}

class FormValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "FormValidationError";
    this.status = 400;
  }
}
