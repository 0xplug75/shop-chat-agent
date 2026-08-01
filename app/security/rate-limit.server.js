import { createHash } from "node:crypto";
import prisma from "../db.server";

export class InMemoryRateLimiter {
  constructor({ limit = 30, windowMs = 60_000 } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.entries = new Map();
  }

  consume(key, now = Date.now()) {
    const windowStart = now - this.windowMs;
    const previous = this.entries.get(key) || [];
    const active = previous.filter((timestamp) => timestamp > windowStart);

    if (active.length >= this.limit) {
      const retryAfterMs = Math.max(active[0] + this.windowMs - now, 1);
      this.entries.set(key, active);
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    active.push(now);
    this.entries.set(key, active);
    return {
      allowed: true,
      remaining: Math.max(this.limit - active.length, 0),
      retryAfterMs: 0,
    };
  }

  clear() {
    this.entries.clear();
  }
}

export class PrismaRateLimitStore {
  constructor({ client = prisma } = {}) {
    this.client = client;
  }

  async increment({ id, shopId, keyHash, windowStart, expiresAt }) {
    return this.client.rateLimitBucket.upsert({
      where: { id },
      create: {
        id,
        shopId,
        keyHash,
        windowStart,
        expiresAt,
        count: 1,
      },
      update: {
        count: { increment: 1 },
        expiresAt,
      },
      select: { count: true },
    });
  }
}

export class DurableRateLimiter {
  constructor({ limit = 30, windowMs = 60_000, store } = {}) {
    if (!store?.increment) throw new Error("Rate-limit store is required");
    this.limit = limit;
    this.windowMs = windowMs;
    this.store = store;
  }

  async consume({ shopId, key }, now = Date.now()) {
    const windowStartMs = Math.floor(now / this.windowMs) * this.windowMs;
    const keyHash = createHash("sha256").update(String(key)).digest("hex");
    const id = createHash("sha256")
      .update(`${shopId}:${keyHash}:${windowStartMs}`)
      .digest("hex");
    const record = await this.store.increment({
      id,
      shopId,
      keyHash,
      windowStart: new Date(windowStartMs),
      expiresAt: new Date(windowStartMs + this.windowMs * 2),
    });
    const retryAfterMs = Math.max(windowStartMs + this.windowMs - now, 1);
    return {
      allowed: record.count <= this.limit,
      remaining: Math.max(this.limit - record.count, 0),
      retryAfterMs: record.count <= this.limit ? 0 : retryAfterMs,
    };
  }
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitStore = new PrismaRateLimitStore();
const rateLimitDefinitions = {
  visitor: envLimit("WIDGET_RATE_LIMIT_PER_MINUTE", 30),
  network: envLimit("WIDGET_NETWORK_RATE_LIMIT_PER_MINUTE", 90),
  shop: envLimit("WIDGET_SHOP_RATE_LIMIT_PER_MINUTE", 300),
  bootstrap: envLimit("WIDGET_BOOTSTRAP_RATE_LIMIT_PER_MINUTE", 20),
};

const testLimiters =
  global.intentCartRateLimiters ||
  Object.fromEntries(
    Object.entries(rateLimitDefinitions).map(([name, limit]) => [
      name,
      new InMemoryRateLimiter({ limit, windowMs: RATE_LIMIT_WINDOW_MS }),
    ]),
  );

if (process.env.NODE_ENV !== "production") {
  global.intentCartRateLimiters = testLimiters;
}

const durableLimiters = Object.fromEntries(
  Object.entries(rateLimitDefinitions).map(([name, limit]) => [
    name,
    new DurableRateLimiter({
      limit,
      windowMs: RATE_LIMIT_WINDOW_MS,
      store: rateLimitStore,
    }),
  ]),
);

export async function consumeWidgetRateLimit(context, { visitorId } = {}) {
  const boundVisitorId = context.visitorId || visitorId;
  const visitorSubject = boundVisitorId
    ? `visitor:${boundVisitorId}`
    : context.tokenId
      ? `token:${context.tokenId}`
      : `request:${context.requestId}`;
  const layers = [
    ["visitor", visitorSubject],
    ["shop", "all-widget-traffic"],
  ];
  if (context.networkSubject) {
    layers.splice(1, 0, ["network", context.networkSubject]);
  }
  return consumeLayers(context.shopId, layers);
}

export async function consumeWidgetBootstrapRateLimit(context) {
  const subject = context.networkSubject || "all-bootstrap-traffic";
  return consumeLayers(context.shopId, [["bootstrap", subject]]);
}

async function consumeLayers(shopId, layers) {
  let combined = null;
  for (const [name, key] of layers) {
    const limiter =
      process.env.NODE_ENV === "test"
        ? testLimiters[name]
        : durableLimiters[name];
    const result =
      process.env.NODE_ENV === "test"
        ? limiter.consume(`${shopId}:${key}`)
        : await limiter.consume({ shopId, key: `${name}:${key}` });
    combined = combined
      ? {
          allowed: combined.allowed && result.allowed,
          remaining: Math.min(combined.remaining, result.remaining),
          retryAfterMs: Math.max(combined.retryAfterMs, result.retryAfterMs),
        }
      : result;
    if (!result.allowed) return combined;
  }
  return combined;
}

function envLimit(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
