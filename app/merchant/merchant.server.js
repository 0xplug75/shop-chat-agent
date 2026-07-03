import editableMerchantConfig from "./merchant.config.json";
import { merchantDefaults } from "./merchant.defaults";
import { validateMerchantConfig } from "./merchant.schema";

let cachedMerchantConfig;

/**
 * Loads, merges, validates, and returns the merchant configuration.
 * Runtime code should call this function instead of importing the JSON file.
 *
 * Future source order:
 * JSON -> Supabase -> cache
 *
 * The public function shape should stay stable when the backing store changes.
 * @returns {Object} Validated merchant configuration
 */
export function getMerchantConfig() {
  if (cachedMerchantConfig) {
    return cachedMerchantConfig;
  }

  const mergedConfig = mergeDefaults(merchantDefaults, editableMerchantConfig);
  const validation = validateMerchantConfig(mergedConfig);

  if (!validation.valid) {
    // Merchant config is on the chat hot path (buildSystemInstruction runs on
    // every turn). A malformed merchant.config.json must not break every
    // conversation, so log and fall back to known-good defaults instead of
    // throwing here.
    console.error(`[merchant] Invalid merchant configuration, falling back to defaults: ${validation.errors.join("; ")}`);
    cachedMerchantConfig = Object.freeze(mergeDefaults(merchantDefaults, {}));
    return cachedMerchantConfig;
  }

  cachedMerchantConfig = Object.freeze(mergedConfig);
  return cachedMerchantConfig;
}

/**
 * Clears the in-memory cache. Intended for tests and future admin save flows.
 */
export function clearMerchantConfigCache() {
  cachedMerchantConfig = undefined;
}

function mergeDefaults(defaults, overrides) {
  if (Array.isArray(defaults)) {
    return Array.isArray(overrides) ? [...overrides] : [...defaults];
  }

  if (!isPlainObject(defaults)) {
    return overrides ?? defaults;
  }

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

