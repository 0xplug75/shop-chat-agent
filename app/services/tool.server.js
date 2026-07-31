import AppConfig from "./config.server";

/**
 * Normalizes Shopify catalog payloads. Tool execution and persistence live in
 * the registry and orchestrator; this module has no side effects.
 */
export function createToolService() {
  return { processProductSearchResult };
}

export function processProductSearchResult(toolResponse) {
  const content = toolResponse?.content?.[0]?.text;
  if (!content) return [];

  try {
    const payload = typeof content === "string" ? JSON.parse(content) : content;
    if (!Array.isArray(payload?.products)) return [];
    return payload.products
      .map(formatProductData)
      .filter((product) => product.id)
      .slice(0, AppConfig.tools.maxProductsToDisplay);
  } catch (_error) {
    return [];
  }
}

function formatProductData(product) {
  const variants = Array.isArray(product.variants)
    ? product.variants.map((variant) => ({
        id: String(variant.id || variant.variant_id || ""),
        title: variant.title || variant.name || "",
        price: formatMoney(variant.price),
        currency: variant.currency || variant.price?.currency || product.price_range?.min?.currency || "",
        available: variant.available ?? variant.available_for_sale ?? variant.availability?.available ?? null,
        selected_options: normalizeSelectedOptions(variant.selected_options || variant.options || [])
      })).filter((variant) => variant.id)
    : [];
  const id = String(product.product_id || product.id || "");

  return {
    id,
    product_id: id,
    title: product.title || "Product",
    price: product.price_range
      ? formatMoney(product.price_range.min)
      : variants[0]?.price || "Price not available",
    price_range: product.price_range || null,
    image_url: product.image_url || product.media?.[0]?.url || "",
    description: getDescriptionText(product.description),
    url: product.url || "",
    options: normalizeProductOptions(product.options || []),
    variants,
    available: product.available ?? product.available_for_sale ?? variants.some((variant) => variant.available === true),
    rating: product.rating || null,
    tags: product.tags || []
  };
}

function normalizeProductOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map((option) => {
    if (typeof option === "string") return { name: "Option", values: [option] };
    return {
      name: formatOptionValue(option?.name) || "Option",
      values: Array.isArray(option?.values)
        ? option.values.map(formatOptionValue).filter(Boolean)
        : []
    };
  });
}

function normalizeSelectedOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map((option) => {
    if (typeof option === "string") return option;
    const name = formatOptionValue(option?.name) || "Option";
    const value = formatOptionValue(option?.label || option?.value || option?.name || option);
    return value ? `${name}: ${value}` : name;
  }).filter(Boolean);
}

function formatOptionValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return value.label || value.name || value.value || value.title || "";
}

function formatMoney(money) {
  if (money === null || money === undefined) return "";
  if (typeof money === "string" || typeof money === "number") return String(money);
  if (money.amount === null || money.amount === undefined) return "";
  return `${money.currency || ""} ${money.amount}`.trim();
}

function getDescriptionText(description) {
  if (!description) return "";
  if (typeof description === "string") return description;
  return description.text || stripHtml(description.html || "");
}

function stripHtml(value) {
  return String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
