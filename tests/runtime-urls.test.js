import { describe, expect, it } from "vitest";
import {
  resolveRuntimeUrls,
  RuntimeUrlConfigurationError,
} from "../app/config/runtime-urls";

describe("runtime URL resolution", () => {
  it("derives every Shopify projection from one canonical origin", () => {
    expect(
      resolveRuntimeUrls({
        APP_ENV: "production",
        APP_URL: "https://intentcart.example",
        SHOPIFY_APP_URL: "https://intentcart.example/",
        WIDGET_ALLOWED_ORIGINS:
          "https://alpha.myshopify.com, https://shop.example",
      }),
    ).toEqual({
      environment: "production",
      appUrl: "https://intentcart.example",
      adminAuthCallbackUrl: "https://intentcart.example/auth/callback",
      customerOAuthRedirectUrl:
        "https://intentcart.example/customer-auth/callback",
      appProxyUrl: "https://intentcart.example/widget",
      healthcheckUrl: "https://intentcart.example/health",
      widgetAllowedOrigins: [
        "https://alpha.myshopify.com",
        "https://shop.example",
      ],
    });
  });

  it("rejects divergent aliases and redirect origins", () => {
    expect(() =>
      resolveRuntimeUrls({
        APP_ENV: "production",
        APP_URL: "https://one.example",
        SHOPIFY_APP_URL: "https://two.example",
      }),
    ).toThrow("must resolve to the same origin");

    expect(() =>
      resolveRuntimeUrls({
        APP_ENV: "production",
        SHOPIFY_APP_URL: "https://intentcart.example",
        REDIRECT_URL: "https://stale.example/customer-auth/callback",
      }),
    ).toThrow("canonical application origin");
  });

  it("allows ephemeral development URLs but refuses them in stable environments", () => {
    expect(
      resolveRuntimeUrls({
        APP_ENV: "development",
        SHOPIFY_APP_URL: "https://fresh.trycloudflare.com",
      }).appUrl,
    ).toBe("https://fresh.trycloudflare.com");

    expect(() =>
      resolveRuntimeUrls({
        APP_ENV: "preview",
        SHOPIFY_APP_URL: "https://stale.trycloudflare.com",
      }),
    ).toThrow(RuntimeUrlConfigurationError);
    expect(() =>
      resolveRuntimeUrls({
        APP_ENV: "production",
        SHOPIFY_APP_URL: "http://localhost:3000",
      }),
    ).toThrow(RuntimeUrlConfigurationError);
  });

  it("uses a deterministic local fallback only outside preview and production", () => {
    expect(resolveRuntimeUrls({ APP_ENV: "test", PORT: "4100" }).appUrl).toBe(
      "http://localhost:4100",
    );
    expect(() => resolveRuntimeUrls({ APP_ENV: "production" })).toThrow(
      "is required in preview and production",
    );
  });

  it("rejects paths, credentials, and malformed storefront allowlist entries", () => {
    expect(() =>
      resolveRuntimeUrls({
        APP_ENV: "production",
        SHOPIFY_APP_URL: "https://intentcart.example/app",
      }),
    ).toThrow("only an origin");
    expect(() =>
      resolveRuntimeUrls({
        APP_ENV: "production",
        SHOPIFY_APP_URL: "https://user:pass@intentcart.example",
      }),
    ).toThrow("must not contain credentials");
    expect(() =>
      resolveRuntimeUrls({
        APP_ENV: "development",
        WIDGET_ALLOWED_ORIGINS: "not-a-url",
      }),
    ).toThrow("invalid storefront origin");
  });
});
