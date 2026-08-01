import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const APP_ROUTE_SOURCE = readFileSync(
  new URL("../app/routes/app.jsx", import.meta.url),
  "utf8",
);

describe("Shopify Admin navigation invariant", () => {
  it("contains exactly the five approved primary surfaces in order", () => {
    const links = [
      ...APP_ROUTE_SOURCE.matchAll(
        /<s-link href="([^"]+)"[^>]*>([^<]+)<\/s-link>/g,
      ),
    ].map(([, href, label]) => ({ href, label: label.trim() }));

    expect(links).toEqual([
      { href: "/app", label: "Home" },
      { href: "/app/assistant", label: "Assistant" },
      { href: "/app/widget", label: "Widget" },
      { href: "/app/knowledge", label: "Knowledge" },
      { href: "/app/commerce", label: "Commerce" },
    ]);
  });
});
