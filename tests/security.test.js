import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  issueWidgetToken,
  verifyWidgetToken,
  WidgetTokenError
} from "../app/security/widget-token.server";
import {
  assertTrustedShopifyUrl,
  normalizeShopDomain,
  normalizeStorefrontOrigin
} from "../app/security/shopify-domain.server";
import { requireWidgetRequestContext } from "../app/security/merchant-context.server";
import { decryptSecret, encryptSecret } from "../app/security/encryption.server";
import { isAllowedOrigin } from "../app/lib/cors.server";

const SHOP = "alpha-store.myshopify.com";
const ORIGIN = `https://${SHOP}`;

describe("widget security boundaries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("issues an origin-bound token and verifies its claims", () => {
    const issued = issueWidgetToken({
      shopId: "shop-alpha",
      shopDomain: SHOP,
      storefrontOrigin: ORIGIN,
      ttlSeconds: 120
    });

    expect(verifyWidgetToken(issued.token)).toMatchObject({
      shopId: "shop-alpha",
      shopDomain: SHOP,
      storefrontOrigin: ORIGIN
    });

    const request = new Request("https://app.example.com/chat", {
      headers: {
        Authorization: `Bearer ${issued.token}`,
        Origin: ORIGIN,
        "X-Request-Id": "request-123"
      }
    });
    expect(requireWidgetRequestContext(request)).toMatchObject({
      shopId: "shop-alpha",
      shopDomain: SHOP,
      storefrontOrigin: ORIGIN,
      requestId: "request-123"
    });
  });

  it("rejects tampered, expired, and cross-origin tokens", () => {
    const { token } = issueWidgetToken({
      shopId: "shop-alpha",
      shopDomain: SHOP,
      storefrontOrigin: ORIGIN,
      ttlSeconds: 60
    });
    const parts = token.split(".");
    const tamperedPayload = `${parts[1].slice(0, -1)}${parts[1].endsWith("a") ? "b" : "a"}`;
    expect(() => verifyWidgetToken(`${parts[0]}.${tamperedPayload}.${parts[2]}`))
      .toThrow(WidgetTokenError);

    const wrongOriginRequest = new Request("https://app.example.com/chat", {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: "https://other-store.myshopify.com"
      }
    });
    expect(() => requireWidgetRequestContext(wrongOriginRequest)).toThrow(WidgetTokenError);

    vi.advanceTimersByTime(61_000);
    expect(() => verifyWidgetToken(token)).toThrow("Expired widget token");
  });

  it("accepts only canonical shop domains and trusted external URLs", () => {
    expect(normalizeShopDomain("HTTPS://ALPHA-STORE.MYSHOPIFY.COM"))
      .toBe(SHOP);
    expect(() => normalizeShopDomain("alpha-store.example.com")).toThrow();
    expect(normalizeStorefrontOrigin(ORIGIN)).toBe(ORIGIN);
    expect(() => normalizeStorefrontOrigin(`${ORIGIN}/products`)).toThrow();

    expect(assertTrustedShopifyUrl(`${ORIGIN}/checkouts/cn/test`, { shopDomain: SHOP }).hostname)
      .toBe(SHOP);
    expect(() => assertTrustedShopifyUrl(
      "https://other-store.myshopify.com/checkouts/cn/test",
      { shopDomain: SHOP }
    )).toThrow("not trusted");
    expect(() => assertTrustedShopifyUrl("https://attacker.example/checkout", { shopDomain: SHOP }))
      .toThrow("not trusted");
  });

  it("uses CORS only as preflight filtering while the signed token binds the tenant", () => {
    expect(isAllowedOrigin(ORIGIN)).toBe(true);
    expect(isAllowedOrigin("https://attacker.example")).toBe(false);
  });

  it("encrypts secrets with authenticated encryption and rejects tampering", () => {
    const encrypted = encryptSecret("customer-access-token");
    expect(encrypted).not.toContain("customer-access-token");
    expect(decryptSecret(encrypted)).toBe("customer-access-token");

    const parts = encrypted.split(".");
    parts[3] = `${parts[3].slice(0, -1)}${parts[3].endsWith("a") ? "b" : "a"}`;
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
});
