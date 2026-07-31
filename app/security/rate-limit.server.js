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
      retryAfterMs: 0
    };
  }

  clear() {
    this.entries.clear();
  }
}
const globalLimiter = global.intentCartRateLimiter || new InMemoryRateLimiter({
  limit: Number(process.env.WIDGET_RATE_LIMIT_PER_MINUTE || 30),
  windowMs: 60_000
});

if (process.env.NODE_ENV !== "production") {
  global.intentCartRateLimiter = globalLimiter;
}

export function consumeWidgetRateLimit(context) {
  const sessionKey = context.conversationId || "new";
  return globalLimiter.consume(`${context.shopId}:${sessionKey}`);
}
