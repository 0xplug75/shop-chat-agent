import { createHmac, timingSafeEqual } from "node:crypto";
import { WidgetTokenPayloadSchema } from "../contracts/commerce.schemas.server";

const TOKEN_VERSION = 2;
const DEFAULT_TTL_SECONDS = 10 * 60;
const MAX_TTL_SECONDS = 15 * 60;

export class WidgetTokenError extends Error {
  constructor(message = "Invalid widget token") {
    super(message);
    this.name = "WidgetTokenError";
    this.status = 401;
  }
}
export function issueWidgetToken({
  shopId,
  shopDomain,
  storefrontOrigin = null,
  visitorId,
  ttlSeconds,
}) {
  const now = Math.floor(Date.now() / 1000);
  const effectiveTtl = Math.min(
    Math.max(
      Number(
        ttlSeconds ||
          process.env.WIDGET_TOKEN_TTL_SECONDS ||
          DEFAULT_TTL_SECONDS,
      ),
      60,
    ),
    MAX_TTL_SECONDS,
  );
  const payload = WidgetTokenPayloadSchema.parse({
    version: TOKEN_VERSION,
    shopId,
    shopDomain,
    storefrontOrigin,
    visitorId,
    issuedAt: now,
    expiresAt: now + effectiveTtl,
    tokenId: crypto.randomUUID(),
  });
  const encodedHeader = encodeJson({ algorithm: "HS256", type: "ICW" });
  const encodedPayload = encodeJson(payload);
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = sign(unsignedToken);

  return {
    token: `${unsignedToken}.${signature}`,
    expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
  };
}

export function verifyWidgetToken(token) {
  if (typeof token !== "string" || token.length > 8192) {
    throw new WidgetTokenError();
  }

  const parts = token.split(".");
  if (parts.length !== 3) throw new WidgetTokenError();

  const [encodedHeader, encodedPayload, suppliedSignature] = parts;
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = sign(unsignedToken);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);

  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    throw new WidgetTokenError();
  }

  let header;
  let payload;
  try {
    header = decodeJson(encodedHeader);
    payload = WidgetTokenPayloadSchema.parse(decodeJson(encodedPayload));
  } catch (_error) {
    throw new WidgetTokenError();
  }

  if (header?.algorithm !== "HS256" || header?.type !== "ICW") {
    throw new WidgetTokenError();
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.expiresAt <= now || payload.issuedAt > now + 30) {
    throw new WidgetTokenError("Expired widget token");
  }

  return payload;
}

function sign(value) {
  return createHmac("sha256", getSigningSecret())
    .update(value)
    .digest("base64url");
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJson(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function getSigningSecret() {
  const secret =
    process.env.WIDGET_SIGNING_SECRET || process.env.SHOPIFY_API_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "WIDGET_SIGNING_SECRET must contain at least 32 characters",
    );
  }
  return secret;
}
