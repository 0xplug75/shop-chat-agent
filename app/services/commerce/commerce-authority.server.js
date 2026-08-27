import { createHash } from "node:crypto";

export class CommerceAuthorityError extends Error {
  constructor(
    code,
    message,
    { status = 502, definitiveBeforeMutation = false, cause } = {},
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = "CommerceAuthorityError";
    this.code = code;
    this.status = status;
    this.definitiveBeforeMutation = definitiveBeforeMutation;
    this.publicMessage =
      "Shopify could not verify the requested commerce action.";
  }
}

export function createCommerceAuthority({
  provider,
  now = () => new Date(),
} = {}) {
  if (!provider) throw new Error("Commerce provider is required");

  return {
    async revalidate({ handoff, variantRef, quantity, cartRef, buyerContext }) {
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
        return {
          status: "invalid_quantity",
          safeReasonCode: "QUANTITY_OUT_OF_RANGE",
        };
      }

      let productResult;
      try {
        productResult = await provider.getProduct({
          id: handoff.selectedProductRef.productId,
          context: { buyerContext, marketRef: handoff.marketRef },
        });
      } catch (cause) {
        throw new CommerceAuthorityError(
          "FRESH_PRODUCT_READ_FAILED",
          "Fresh Shopify product read failed",
          { cause },
        );
      }
      const product = productResult?.product;
      if (!product || !productMatches(product, handoff.selectedProductRef)) {
        return {
          status: "invalid_variant",
          safeReasonCode: "PRODUCT_REFERENCE_NOT_FOUND",
        };
      }
      const variant = findVariant(product, variantRef);
      if (!variant) {
        return {
          status: "invalid_variant",
          safeReasonCode: "VARIANT_NOT_FOUND",
        };
      }
      const unitPrice = extractUnitPrice(variant, product);
      if (!unitPrice) {
        throw new CommerceAuthorityError(
          "AUTHORITATIVE_PRICE_UNAVAILABLE",
          "Shopify did not return an authoritative unit price",
        );
      }
      if (!isAvailable(variant, product)) {
        return {
          status: "unavailable",
          safeReasonCode: "VARIANT_UNAVAILABLE",
        };
      }
      const availableQuantity = extractAvailableQuantity(variant);
      if (availableQuantity !== null && availableQuantity < quantity) {
        return {
          status: "unavailable",
          safeReasonCode: "INSUFFICIENT_STOCK",
        };
      }

      const observedAt = now().toISOString();
      let cartSnapshot = null;
      if (cartRef) {
        cartSnapshot = await readCart(provider, cartRef);
        if (!cartSnapshot.cart) {
          return { status: "stale_cart" };
        }
      }
      const cartVersion = cartSnapshot ? cartSnapshot.cartVersion : undefined;
      const baselineQuantity = cartSnapshot
        ? quantityForVariant(cartSnapshot.cart, variantRef)
        : 0;
      const commerceSnapshotRef = opaqueHash("snapshot:shopify", {
        productId: handoff.selectedProductRef.productId,
        variantRef,
        quantity,
        unitPrice,
        availableQuantity,
        cartRef: cartRef || null,
        cartVersion: cartVersion || null,
        observedAt,
      });

      return {
        status: "valid",
        candidate: {
          productRef: handoff.selectedProductRef,
          variantRef,
          quantity,
          unitPrice,
        },
        commerceSnapshotRef,
        cartRef: cartRef || undefined,
        cartVersion,
        baselineQuantity,
        observedAt,
      };
    },

    async mutateAndVerify({
      action,
      receipt,
      session,
      idempotencyKey,
      buyerContext,
      baselineQuantity = 0,
    }) {
      if (action === "request_cart_add") {
        const upstream = await provider.addConfirmedItem({
          cartId: receipt.cartRef || session.cartId || null,
          productId: receipt.candidate.productRef.productId,
          variantId: receipt.candidate.variantRef,
          quantity: receipt.candidate.quantity,
          buyerContext,
          idempotencyKey,
        });
        const cartId = upstream?.cartId || upstream?.cart?.id;
        if (!cartId) {
          throw new CommerceAuthorityError(
            "AUTHORITATIVE_CART_ID_MISSING",
            "Shopify did not return a cart id after mutation",
          );
        }
        const verified = await readCart(provider, cartId);
        assertAppliedQuantity(
          verified.cart,
          receipt.candidate,
          baselineQuantity,
        );
        return authoritativeCartResult({
          provider,
          cartId,
          verified,
          continueUrl: upstream.continueUrl || verified.continueUrl,
          now,
        });
      }

      if (action === "request_checkout_handoff") {
        const cartId = receipt.cartRef || session.cartId;
        if (!cartId) {
          throw new CommerceAuthorityError(
            "CART_REQUIRED_FOR_CHECKOUT_HANDOFF",
            "Checkout handoff requires an authoritative cart",
            { status: 409, definitiveBeforeMutation: true },
          );
        }
        const result = await provider.createCheckoutHandoff({
          cartId,
          cartSnapshot: session.buyerContext?.cartSnapshot,
          idempotencyKey,
        });
        if (!result?.checkoutUrl) {
          throw new CommerceAuthorityError(
            "AUTHORITATIVE_CHECKOUT_HANDOFF_MISSING",
            "Shopify did not return a checkout handoff",
          );
        }
        const verified = await readCart(provider, cartId);
        return {
          ...authoritativeCartResult({
            provider,
            cartId,
            verified,
            continueUrl: result.checkoutUrl,
            now,
          }),
          checkoutUrl: result.checkoutUrl,
        };
      }

      throw new CommerceAuthorityError(
        "ACTION_NOT_EXECUTABLE_IN_V1",
        "Commerce action is not executable in V1",
        { status: 400, definitiveBeforeMutation: true },
      );
    },

    async reconcile({ action, receipt, session, baselineQuantity = 0 }) {
      const cartId = receipt.cartRef || session.cartId;
      if (!cartId) return { status: "unknown" };
      try {
        const verified = await readCart(provider, cartId);
        if (action === "request_cart_add") {
          const quantity = quantityForVariant(
            verified.cart,
            receipt.candidate.variantRef,
          );
          if (quantity < baselineQuantity + receipt.candidate.quantity) {
            return { status: "not_applied" };
          }
        }
        if (action === "request_checkout_handoff" && !verified.continueUrl) {
          return { status: "unknown" };
        }
        return {
          status: "succeeded",
          result: authoritativeCartResult({
            provider,
            cartId,
            verified,
            continueUrl: verified.continueUrl,
            now,
          }),
        };
      } catch (_error) {
        return { status: "unknown" };
      }
    },
  };
}

async function readCart(provider, cartId) {
  let result;
  try {
    result = await provider.getCart({ cartId });
  } catch (cause) {
    throw new CommerceAuthorityError(
      "FRESH_CART_READ_FAILED",
      "Fresh Shopify cart read failed",
      { cause },
    );
  }
  const cart = result?.cart || null;
  return {
    cart,
    cartVersion: cart ? extractCartVersion(result, cart) : undefined,
    continueUrl:
      result?.continueUrl || cart?.continue_url || cart?.continueUrl || null,
  };
}

function authoritativeCartResult({
  provider,
  cartId,
  verified,
  continueUrl,
  now,
}) {
  const observedAt = now().toISOString();
  const authorityRef = opaqueHash("authority:shopify", {
    provider: provider.id,
    cartId,
    cartVersion: verified.cartVersion,
    observedAt,
  });
  return {
    cartId,
    cart: verified.cart,
    cartVersion: verified.cartVersion,
    commerceStateRef: opaqueHash("state:cart", {
      cartId,
      cartVersion: verified.cartVersion,
    }),
    authorityRef,
    observedAt,
    continueUrl: continueUrl || null,
  };
}

function assertAppliedQuantity(cart, candidate, baselineQuantity) {
  const current = quantityForVariant(cart, candidate.variantRef);
  if (current < baselineQuantity + candidate.quantity) {
    throw new CommerceAuthorityError(
      "MUTATION_NOT_VERIFIED",
      "Fresh Shopify cart state does not contain the confirmed mutation",
    );
  }
}

function productMatches(product, productRef) {
  const id = String(
    product.productId || product.product_id || product.id || "",
  );
  return id === productRef.productId;
}

function findVariant(product, variantRef) {
  return (Array.isArray(product.variants) ? product.variants : []).find(
    (variant) =>
      String(variant?.id || variant?.variant_id || "") === variantRef,
  );
}

function isAvailable(variant, product) {
  const value =
    variant.available ??
    variant.available_for_sale ??
    variant.availability?.available ??
    product.available ??
    product.available_for_sale;
  return value === true;
}

function extractAvailableQuantity(variant) {
  const value =
    variant.quantityAvailable ??
    variant.quantity_available ??
    variant.availableQuantity ??
    variant.availability?.quantity ??
    null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function extractUnitPrice(variant, product) {
  return (
    normalizeMoney(variant.unitPrice) ||
    normalizeDisplayMoney(variant.price, variant.currency) ||
    normalizeMoney(product.unitPrice) ||
    normalizeMoney(product.price_range?.min) ||
    normalizeDisplayMoney(product.price, product.currency)
  );
}

function normalizeMoney(value) {
  if (!value || typeof value !== "object") return null;
  const currency = String(
    value.currency || value.currencyCode || "",
  ).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  if (Number.isInteger(value.amountMinor) && value.amountMinor >= 0) {
    return { amountMinor: value.amountMinor, currency };
  }
  if (value.amount === undefined || value.amount === null) return null;
  const amountMinor = decimalToMinor(value.amount, currency);
  return amountMinor === null ? null : { amountMinor, currency };
}

function normalizeDisplayMoney(value, fallbackCurrency) {
  if (value && typeof value === "object") return normalizeMoney(value);
  const text = String(value || "").trim();
  const match = text.match(/(?:^|\s)([A-Z]{3})\s+([0-9]+(?:[.,][0-9]+)?)/);
  const currency = String(match?.[1] || fallbackCurrency || "").toUpperCase();
  const amount =
    match?.[2] || (/^[0-9]+(?:[.,][0-9]+)?$/.test(text) ? text : null);
  if (!amount || !/^[A-Z]{3}$/.test(currency)) return null;
  const amountMinor = decimalToMinor(amount.replace(",", "."), currency);
  return amountMinor === null ? null : { amountMinor, currency };
}

function decimalToMinor(value, currency) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const digits = currencyFractionDigits(currency);
  const [whole, fraction = ""] = text.split(".");
  const normalizedFraction = `${fraction}${"0".repeat(digits)}`.slice(
    0,
    digits,
  );
  const amount = Number(whole) * 10 ** digits + Number(normalizedFraction || 0);
  return Number.isSafeInteger(amount) ? amount : null;
}

function currencyFractionDigits(currency) {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits;
  } catch (_error) {
    return 2;
  }
}

function extractCartVersion(result, cart) {
  const explicit =
    result?.cartVersion ||
    cart?.cartVersion ||
    cart?.cart_version ||
    cart?.version ||
    cart?.updated_at ||
    cart?.updatedAt;
  if (explicit !== undefined && explicit !== null && String(explicit)) {
    return opaqueHash("cartv", String(explicit));
  }
  return opaqueHash("cartv", cart);
}

function quantityForVariant(cart, variantRef) {
  const lines = cart?.line_items || cart?.lines || cart?.items || [];
  return (Array.isArray(lines) ? lines : []).reduce((total, line) => {
    const id = String(
      line?.item?.id ||
        line?.merchandise?.id ||
        line?.variantId ||
        line?.variant_id ||
        line?.id ||
        "",
    );
    return id === variantRef ? total + Number(line?.quantity || 0) : total;
  }, 0);
}

function opaqueHash(prefix, value) {
  return `${prefix}:${createHash("sha256")
    .update(stableStringify(value))
    .digest("hex")}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
