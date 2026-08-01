import prisma from "../db.server";
import editableMerchantConfig from "./merchant.config.json";
import { merchantDefaults } from "./merchant.defaults";
import { parseMerchantConfig } from "./merchant.schema";

export class MerchantConfigVersionConflictError extends Error {
  constructor() {
    super("Merchant configuration was updated by another request");
    this.name = "MerchantConfigVersionConflictError";
    this.status = 409;
  }
}

export async function getMerchantConfig(context) {
  return getEffectiveMerchantConfig(context);
}

export async function getEffectiveMerchantConfig(context) {
  const snapshot = await getMerchantConfigSnapshot(context);
  return snapshot.config;
}

export async function getMerchantConfigSnapshot(context) {
  assertContext(context);
  let record = await prisma.merchantConfig.findUnique({
    where: { shopId: context.shopId },
  });

  if (!record) {
    record = await createDefaultMerchantConfig(context);
  }

  return {
    config: fromRecord(record),
    version: record.version,
    updatedAt: record.updatedAt,
  };
}

export async function createDefaultMerchantConfig(context) {
  assertContext(context);
  const seed = getSeedMerchantConfig();

  return prisma.merchantConfig.upsert({
    where: { shopId: context.shopId },
    create: toRecord(context.shopId, seed),
    update: {},
  });
}

export async function updateMerchantConfig(context, input, expectedVersion) {
  assertContext(context);
  const parsed = parseMerchantConfig(input);
  const result = await prisma.merchantConfig.updateMany({
    where: {
      shopId: context.shopId,
      version: expectedVersion,
    },
    data: {
      ...toRecord(undefined, parsed),
      shopId: undefined,
      version: { increment: 1 },
    },
  });

  if (result.count !== 1) throw new MerchantConfigVersionConflictError();
  return getEffectiveMerchantConfig(context);
}

export function getSeedMerchantConfig() {
  return parseMerchantConfig(
    mergeDefaults(merchantDefaults, editableMerchantConfig),
  );
}

export function clearMerchantConfigCache() {
  // Kept for compatibility with earlier callers. Configuration is no longer
  // stored in a process-global cache.
}

function fromRecord(record) {
  const seed = getSeedMerchantConfig();
  const legacy = {
    ...seed,
    assistant: {
      ...seed.assistant,
      name: record.assistantName,
      personality: record.personality,
      brandVoice: record.brandVoice,
      welcomeMessage: record.welcomeMessage,
      quickActions: record.quickPrompts,
    },
    shopping: {
      ...seed.shopping,
      ...record.commerceRules,
      recommendationRules: record.recommendationRules,
    },
  };

  return parseMerchantConfig(
    record.settings ? mergeDefaults(legacy, record.settings) : legacy,
  );
}

function toRecord(shopId, config) {
  return {
    ...(shopId ? { shopId } : {}),
    assistantName: config.assistant.name,
    personality: config.assistant.personality,
    brandVoice: config.assistant.brandVoice,
    welcomeMessage: config.assistant.welcomeMessage,
    quickPrompts: config.assistant.quickActions,
    settings: config,
    commerceRules: {
      bundleStrategy: config.shopping.bundleStrategy,
      bestsellerPriority: config.shopping.bestsellerPriority,
      outOfStockPolicy: config.shopping.outOfStockPolicy,
    },
    recommendationRules: config.shopping.recommendationRules,
  };
}

function assertContext(context) {
  if (!context?.shopId) throw new Error("Merchant context is required");
}

function mergeDefaults(defaults, overrides) {
  if (Array.isArray(defaults)) {
    return Array.isArray(overrides) ? [...overrides] : [...defaults];
  }
  if (!isPlainObject(defaults)) return overrides ?? defaults;

  const merged = { ...defaults };
  const safeOverrides = isPlainObject(overrides) ? overrides : {};
  for (const [key, value] of Object.entries(safeOverrides)) {
    if (isPlainObject(value) && isPlainObject(defaults[key])) {
      merged[key] = mergeDefaults(defaults[key], value);
    } else if (Array.isArray(value)) {
      merged[key] = [...value];
    } else if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
