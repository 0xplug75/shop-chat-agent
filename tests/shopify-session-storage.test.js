import { describe, expect, it, vi } from "vitest";
import { Session } from "@shopify/shopify-app-react-router/server";
import {
  EncryptedPrismaSessionStorage,
  ShopifyOfflineTokenRefreshError,
} from "../app/services/shopify-session-storage.server";

const NOW = new Date("2026-08-01T10:00:00.000Z");
const SHOP = "alpha-store.myshopify.com";

describe("encrypted Shopify session storage", () => {
  it("encrypts access and refresh tokens and restores the complete session", async () => {
    const database = createSessionDatabase();
    const storage = createStorage(database);
    const source = offlineSession({
      accessToken: "offline-access-token",
      refreshToken: "offline-refresh-token",
    });

    await expect(storage.storeSession(source)).resolves.toBe(true);
    const row = database.rows.get(source.id);
    expect(row.accessToken).toMatch(/^v1\./);
    expect(row.refreshToken).toMatch(/^v1\./);
    expect(row.accessToken).not.toContain("offline-access-token");
    expect(row.refreshToken).not.toContain("offline-refresh-token");

    await expect(storage.loadSession(source.id)).resolves.toMatchObject({
      accessToken: "offline-access-token",
      refreshToken: "offline-refresh-token",
      refreshTokenExpires: source.refreshTokenExpires,
    });
  });

  it("atomically encrypts legacy plaintext rows on their first load", async () => {
    const source = offlineSession();
    const database = createSessionDatabase([
      {
        ...baseRow(source),
        accessToken: "legacy-access-token",
        refreshToken: "legacy-refresh-token",
      },
    ]);
    const storage = createStorage(database);

    const loaded = await storage.loadSession(source.id);
    expect(loaded.accessToken).toBe("legacy-access-token");
    expect(loaded.refreshToken).toBe("legacy-refresh-token");
    expect(database.rows.get(source.id).accessToken).toMatch(/^v1\./);
    expect(database.rows.get(source.id).refreshToken).toMatch(/^v1\./);
    expect(database.rows.get(source.id).tokenVersion).toBe(2);
  });

  it("rotates an expiring offline token and persists the new pair atomically", async () => {
    const database = createSessionDatabase();
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: "rotated-access-token",
        expires_in: 3600,
        refresh_token: "rotated-refresh-token",
        refresh_token_expires_in: 7_776_000,
        scope: "read_products,write_cart",
      }),
    );
    const storage = createStorage(database, { fetchImpl });
    const source = offlineSession({
      expires: new Date(NOW.getTime() + 60_000),
    });
    await storage.storeSession(source);

    const loaded = await storage.loadSession(source.id);
    expect(loaded).toMatchObject({
      accessToken: "rotated-access-token",
      refreshToken: "rotated-refresh-token",
      scope: "read_products,write_cart",
    });
    expect(loaded.expires).toEqual(new Date(NOW.getTime() + 3_600_000));
    expect(database.rows.get(source.id)).toMatchObject({
      tokenVersion: 2,
      refreshLeaseId: null,
      refreshLeaseExpires: null,
      lastRefreshAt: NOW,
    });

    const request = fetchImpl.mock.calls[0];
    expect(request[0]).toBe(`https://${SHOP}/admin/oauth/access_token`);
    expect(request[1].headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(request[1].redirect).toBe("error");
    expect(request[1].signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(new URLSearchParams(request[1].body))).toEqual({
      client_id: "shopify-api-key",
      client_secret: "shopify-api-secret",
      grant_type: "refresh_token",
      refresh_token: "offline-refresh-token",
    });
  });

  it("allows only one concurrent refresh request", async () => {
    const database = createSessionDatabase();
    const fetchImpl = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return jsonResponse({
        access_token: "one-access-token",
        expires_in: 3600,
        refresh_token: "one-refresh-token",
        refresh_token_expires_in: 7_776_000,
      });
    });
    const storage = createStorage(database, {
      fetchImpl,
      waitMs: 1,
      waitAttempts: 50,
    });
    const source = offlineSession({
      expires: new Date(NOW.getTime() + 60_000),
    });
    await storage.storeSession(source);

    const [first, second] = await Promise.all([
      storage.loadSession(source.id),
      storage.loadSession(source.id),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first.accessToken).toBe("one-access-token");
    expect(second.accessToken).toBe("one-access-token");
  });

  it("invalidates a definitively rejected refresh token and requires reauthorization", async () => {
    const database = createSessionDatabase();
    const storage = createStorage(database, {
      fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: "invalid_request",
            error_description: "This request requires an active refresh_token.",
          },
          401,
        ),
      ),
    });
    const source = offlineSession({
      expires: new Date(NOW.getTime() + 60_000),
    });
    await storage.storeSession(source);

    const error = await storage
      .loadSession(source.id)
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(ShopifyOfflineTokenRefreshError);
    expect(error).toMatchObject({
      code: "offline_refresh_token_invalid",
      retryable: false,
      reauthorizationRequired: true,
    });
    expect(database.rows.get(source.id)).toMatchObject({
      accessToken: "",
      refreshToken: null,
      revokedAt: NOW,
      tokenVersion: 2,
    });
  });

  it("releases the lease but preserves credentials after a transient failure", async () => {
    const database = createSessionDatabase();
    const storage = createStorage(database, {
      fetchImpl: vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: "server_error" }, 503)),
    });
    const source = offlineSession({
      expires: new Date(NOW.getTime() + 60_000),
    });
    await storage.storeSession(source);
    const encryptedRefreshToken = database.rows.get(source.id).refreshToken;

    await expect(storage.loadSession(source.id)).rejects.toMatchObject({
      code: "shopify_refresh_rejected",
      retryable: true,
      reauthorizationRequired: false,
    });
    expect(database.rows.get(source.id)).toMatchObject({
      refreshToken: encryptedRefreshToken,
      refreshLeaseId: null,
      refreshLeaseExpires: null,
      revokedAt: null,
      tokenVersion: 1,
    });
  });

  it("preserves credentials for a non-definitive 400 response", async () => {
    const database = createSessionDatabase();
    const storage = createStorage(database, {
      fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: "invalid_request",
            error_description: "The refresh request could not be processed.",
          },
          400,
        ),
      ),
    });
    const source = offlineSession({
      expires: new Date(NOW.getTime() + 60_000),
    });
    await storage.storeSession(source);
    const encryptedRefreshToken = database.rows.get(source.id).refreshToken;

    await expect(storage.loadSession(source.id)).rejects.toMatchObject({
      code: "shopify_refresh_rejected",
      retryable: true,
      reauthorizationRequired: false,
    });
    expect(database.rows.get(source.id)).toMatchObject({
      refreshToken: encryptedRefreshToken,
      refreshLeaseId: null,
      revokedAt: null,
      tokenVersion: 1,
    });
  });

  it("returns no session for a revoked stored credential", async () => {
    const source = offlineSession();
    const database = createSessionDatabase([
      {
        ...baseRow(source),
        revokedAt: NOW,
      },
    ]);

    await expect(createStorage(database).loadSession(source.id)).resolves.toBe(
      undefined,
    );
  });

  it("times out refresh safely and releases the refresh lease", async () => {
    const database = createSessionDatabase();
    const fetchImpl = vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );
    const storage = createStorage(database, {
      fetchImpl,
      refreshTimeoutMs: 1,
    });
    const source = offlineSession({
      expires: new Date(NOW.getTime() + 60_000),
    });
    await storage.storeSession(source);
    const encryptedRefreshToken = database.rows.get(source.id).refreshToken;

    await expect(storage.loadSession(source.id)).rejects.toMatchObject({
      code: "shopify_refresh_timeout",
      status: 504,
      retryable: true,
      reauthorizationRequired: false,
    });
    expect(database.rows.get(source.id)).toMatchObject({
      refreshToken: encryptedRefreshToken,
      refreshLeaseId: null,
      refreshLeaseExpires: null,
      revokedAt: null,
      tokenVersion: 1,
    });
  });
});

function createStorage(database, overrides = {}) {
  return new EncryptedPrismaSessionStorage(database.prisma, {
    now: () => new Date(NOW),
    apiKey: "shopify-api-key",
    apiSecret: "shopify-api-secret",
    ...overrides,
  });
}

function offlineSession(overrides = {}) {
  return new Session({
    id: `offline_${SHOP}`,
    shop: SHOP,
    state: "",
    isOnline: false,
    scope: "read_products",
    accessToken: "offline-access-token",
    refreshToken: "offline-refresh-token",
    expires: new Date(NOW.getTime() + 20 * 60_000),
    refreshTokenExpires: new Date(NOW.getTime() + 90 * 24 * 60 * 60_000),
    ...overrides,
  });
}

function baseRow(session) {
  return {
    id: session.id,
    shop: session.shop,
    state: session.state,
    isOnline: session.isOnline,
    scope: session.scope,
    expires: session.expires,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    refreshTokenExpires: session.refreshTokenExpires,
    tokenVersion: 1,
    refreshLeaseId: null,
    refreshLeaseExpires: null,
    lastRefreshAt: null,
    revokedAt: null,
    userId: null,
    firstName: null,
    lastName: null,
    email: null,
    accountOwner: false,
    locale: null,
    collaborator: false,
    emailVerified: false,
  };
}

function createSessionDatabase(initialRows = []) {
  const rows = new Map(initialRows.map((row) => [row.id, { ...row }]));
  const session = {
    count: async () => rows.size,
    findUnique: async ({ where, select }) => {
      const row = rows.get(where.id);
      if (!row) return null;
      if (!select) return { ...row };
      return Object.fromEntries(
        Object.keys(select)
          .filter((key) => select[key])
          .map((key) => [key, row[key]]),
      );
    },
    upsert: async ({ where, create, update }) => {
      const value = rows.has(where.id)
        ? applyUpdate(rows.get(where.id), update)
        : { ...create };
      rows.set(where.id, value);
      return { ...value };
    },
    updateMany: async ({ where, data }) => {
      const row = rows.get(where.id);
      if (!row || !matches(row, where)) return { count: 0 };
      rows.set(where.id, applyUpdate(row, data));
      return { count: 1 };
    },
    deleteMany: async ({ where }) => {
      const ids = where.id?.in || [where.id];
      let count = 0;
      for (const id of ids) count += rows.delete(id) ? 1 : 0;
      return { count };
    },
    findMany: async ({ where, take }) =>
      [...rows.values()]
        .filter((row) => row.shop === where.shop)
        .slice(0, take)
        .map((row) => ({ ...row })),
  };
  return {
    rows,
    prisma: {
      session,
      $transaction: async (callback) => callback({ session }),
    },
  };
}

function matches(row, where) {
  for (const [key, expected] of Object.entries(where)) {
    if (key === "OR") {
      if (!expected.some((condition) => matches(row, condition))) return false;
    } else if (expected && typeof expected === "object" && "lte" in expected) {
      if (!(row[key] <= expected.lte)) return false;
    } else if (row[key] !== expected) {
      return false;
    }
  }
  return true;
}

function applyUpdate(row, data) {
  const updated = { ...row };
  for (const [key, value] of Object.entries(data)) {
    updated[key] =
      value && typeof value === "object" && "increment" in value
        ? Number(updated[key] || 0) + value.increment
        : value;
  }
  return updated;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
