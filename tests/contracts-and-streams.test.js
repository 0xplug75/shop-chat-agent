import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChatRequestSchema,
  ShoppingIntentSchema
} from "../app/contracts/commerce.schemas.server";
import {
  readJsonBodyWithLimit,
  RequestTooLargeError
} from "../app/services/chat-request.server";
import {
  fetchWithTimeout,
  readJsonResponseWithLimit
} from "../app/lib/fetch-with-timeout.server";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public request contracts", () => {
  it("accepts a strict bounded chat payload", () => {
    const parsed = ChatRequestSchema.parse({
      message: "Show me a snowboard under 700 EUR",
      visitor_id: "7e84f2bc-41b8-479e-bfab-75cd7a4ba7df"
    });
    expect(parsed.message).toContain("snowboard");
    expect(() => ChatRequestSchema.parse({ message: "hello", admin: true })).toThrow();
    expect(() => ChatRequestSchema.parse({ message: "x".repeat(2001) })).toThrow();
  });

  it("validates the complete structured intent shape", () => {
    expect(ShoppingIntentSchema.parse({
      goal: "discover",
      category: "snowboard",
      useCase: null,
      budget: { min: null, max: 700, currency: "EUR" },
      attributes: {},
      preferences: ["all mountain"],
      exclusions: [],
      requestedProductIds: [],
      confidence: 0.8,
      missingInformation: []
    }).budget.currency).toBe("EUR");
  });

  it("enforces the request body limit while streaming", async () => {
    const valid = new Request("https://app.example/chat", {
      method: "POST",
      body: JSON.stringify({ message: "hello" })
    });
    await expect(readJsonBodyWithLimit(valid, 100)).resolves.toEqual({ message: "hello" });

    const oversized = new Request("https://app.example/chat", {
      method: "POST",
      body: JSON.stringify({ message: "x".repeat(200) })
    });
    await expect(readJsonBodyWithLimit(oversized, 50)).rejects.toBeInstanceOf(RequestTooLargeError);
  });

  it("rejects oversized upstream JSON before parsing it", async () => {
    const response = new Response(JSON.stringify({ data: "x".repeat(200) }));
    await expect(readJsonResponseWithLimit(response, 50))
      .rejects.toMatchObject({ code: "EXTERNAL_RESPONSE_TOO_LARGE" });
  });

  it("aborts a stalled external request and returns a normalized timeout", async () => {
    vi.stubGlobal("fetch", vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    })));

    await expect(fetchWithTimeout("https://example.test", {}, 5)).rejects.toMatchObject({
      code: "EXTERNAL_TIMEOUT",
      isTimeout: true
    });
  });

  it("keeps the storefront renderer free of dangerous HTML sinks", async () => {
    const source = await readFile(
      new URL("../extensions/chat-bubble/assets/chat.js", import.meta.url),
      "utf8"
    );

    expect(source).not.toMatch(/\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval)\b/);
    expect(source).toContain("textContent");
  });
});
