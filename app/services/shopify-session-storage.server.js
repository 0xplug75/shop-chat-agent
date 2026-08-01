import { randomUUID } from "node:crypto";
import { Session } from "@shopify/shopify-app-react-router/server";
import { decryptSecret, encryptSecret } from "../security/encryption.server";
import { normalizeShopDomain } from "../security/shopify-domain.server";

const DEFAULT_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_LEASE_MS = 30 * 1000;
const DEFAULT_WAIT_MS = 50;
const DEFAULT_WAIT_ATTEMPTS = 20;
const DEFAULT_REFRESH_TIMEOUT_MS = 15_000;

export class ShopifyOfflineTokenRefreshError extends Error {
  constructor(
    message,
    {
      code = "offline_token_refresh_failed",
      status = 503,
      retryable = true,
      reauthorizationRequired = false,
      cause,
    } = {},
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = "ShopifyOfflineTokenRefreshError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.reauthorizationRequired = reauthorizationRequired;
  }
}

export class EncryptedPrismaSessionStorage {
  constructor(
    prisma,
    {
      fetchImpl = global.fetch,
      now = () => new Date(),
      refreshWindowMs = DEFAULT_REFRESH_WINDOW_MS,
      leaseMs = DEFAULT_LEASE_MS,
      waitMs = DEFAULT_WAIT_MS,
      waitAttempts = DEFAULT_WAIT_ATTEMPTS,
      refreshTimeoutMs = DEFAULT_REFRESH_TIMEOUT_MS,
      apiKey = process.env.SHOPIFY_API_KEY,
      apiSecret = process.env.SHOPIFY_API_SECRET,
    } = {},
  ) {
    if (!prisma?.session) throw new Error("Prisma Session model is required");
    if (typeof fetchImpl !== "function")
      throw new Error("A fetch implementation is required");
    this.prisma = prisma;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.refreshWindowMs = refreshWindowMs;
    this.leaseMs = leaseMs;
    this.waitMs = waitMs;
    this.waitAttempts = waitAttempts;
    this.refreshTimeoutMs = refreshTimeoutMs;
    this.apiKey = apiKey || "";
    this.apiSecret = apiSecret || "";
  }

  async storeSession(session) {
    const data = sessionToRow(session);
    await this.prisma.$transaction(async (tx) => {
      await tx.session.upsert({
        where: { id: session.id },
        create: {
          ...data,
          tokenVersion: 1,
          refreshLeaseId: null,
          refreshLeaseExpires: null,
          lastRefreshAt: null,
          revokedAt: null,
        },
        update: {
          ...data,
          tokenVersion: { increment: 1 },
          refreshLeaseId: null,
          refreshLeaseExpires: null,
          revokedAt: null,
        },
      });
    });
    return true;
  }

  async loadSession(id) {
    let row = await this.prisma.session.findUnique({ where: { id } });
    if (!row || row.revokedAt) return undefined;

    row = await this.encryptLegacySecrets(row);
    if (!row || row.revokedAt) return undefined;

    const session = rowToSession(row);
    if (!shouldRefresh(session, this.now(), this.refreshWindowMs))
      return session;
    return this.refreshOfflineSession(row, session);
  }

  async encryptLegacySecrets(row) {
    const accessTokenIsLegacy = isLegacyStoredSecret(row.accessToken);
    const refreshTokenIsLegacy = isLegacyStoredSecret(row.refreshToken);
    if (!accessTokenIsLegacy && !refreshTokenIsLegacy) return row;

    const changes = {
      ...(accessTokenIsLegacy
        ? { accessToken: encryptSecret(row.accessToken) }
        : {}),
      ...(refreshTokenIsLegacy
        ? { refreshToken: encryptSecret(row.refreshToken) }
        : {}),
    };
    const updated = await this.prisma.session.updateMany({
      where: {
        id: row.id,
        tokenVersion: row.tokenVersion,
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
      },
      data: {
        ...changes,
        tokenVersion: { increment: 1 },
      },
    });
    if (updated.count === 1) {
      return {
        ...row,
        ...changes,
        tokenVersion: row.tokenVersion + 1,
      };
    }
    return this.prisma.session.findUnique({ where: { id: row.id } });
  }

  async deleteSession(id) {
    await this.prisma.session.deleteMany({ where: { id } });
    return true;
  }

  async deleteSessions(ids) {
    await this.prisma.session.deleteMany({ where: { id: { in: ids } } });
    return true;
  }

  async findSessionsByShop(shop) {
    const rows = await this.prisma.session.findMany({
      where: { shop, revokedAt: null },
      take: 25,
      orderBy: [{ expires: "desc" }],
    });
    const securedRows = await Promise.all(
      rows.map((row) => this.encryptLegacySecrets(row)),
    );
    return securedRows.filter(Boolean).map(rowToSession);
  }

  async isReady() {
    try {
      await this.prisma.session.count();
      return true;
    } catch (_error) {
      return false;
    }
  }

  async refreshOfflineSession(row, session) {
    if (
      !session.refreshToken ||
      isExpired(session.refreshTokenExpires, this.now())
    ) {
      await this.invalidateSession(row.id, row.tokenVersion);
      throw reauthorizationError(
        "The Shopify offline refresh token is unavailable or expired",
      );
    }
    if (!this.apiKey || !this.apiSecret) {
      throw new ShopifyOfflineTokenRefreshError(
        "Shopify credentials are required to refresh an offline token",
        { code: "shopify_credentials_missing", status: 500, retryable: false },
      );
    }

    const leaseId = randomUUID();
    const leased = await this.prisma.session.updateMany({
      where: {
        id: row.id,
        tokenVersion: row.tokenVersion,
        revokedAt: null,
        OR: [
          { refreshLeaseId: null },
          { refreshLeaseExpires: { lte: this.now() } },
        ],
      },
      data: {
        refreshLeaseId: leaseId,
        refreshLeaseExpires: new Date(this.now().getTime() + this.leaseMs),
      },
    });

    if (leased.count !== 1) {
      return this.waitForConcurrentRefresh(row);
    }

    try {
      const refreshed = await requestOfflineTokenRefresh({
        fetchImpl: this.fetchImpl,
        shop: session.shop,
        refreshToken: session.refreshToken,
        apiKey: this.apiKey,
        apiSecret: this.apiSecret,
        now: this.now,
        timeoutMs: this.refreshTimeoutMs,
      });
      const persisted = await this.persistRefresh(
        row,
        leaseId,
        session,
        refreshed,
      );
      if (persisted) return persisted;
      return this.loadFreshRow(row.id);
    } catch (error) {
      const normalized = normalizeRefreshError(error);
      if (normalized.reauthorizationRequired) {
        await this.invalidateSession(row.id, row.tokenVersion, leaseId);
      } else {
        await this.releaseLease(row.id, row.tokenVersion, leaseId);
      }
      throw normalized;
    }
  }

  async persistRefresh(row, leaseId, previousSession, refreshed) {
    const nextSession = new Session({
      id: previousSession.id,
      shop: previousSession.shop,
      state: previousSession.state,
      isOnline: false,
      scope: refreshed.scope || previousSession.scope,
      accessToken: refreshed.accessToken,
      expires: refreshed.expires,
      refreshToken: refreshed.refreshToken,
      refreshTokenExpires: refreshed.refreshTokenExpires,
    });
    const data = sessionToRow(nextSession);
    const updated = await this.prisma.session.updateMany({
      where: {
        id: row.id,
        tokenVersion: row.tokenVersion,
        refreshLeaseId: leaseId,
        revokedAt: null,
      },
      data: {
        ...data,
        tokenVersion: { increment: 1 },
        refreshLeaseId: null,
        refreshLeaseExpires: null,
        lastRefreshAt: this.now(),
      },
    });
    return updated.count === 1 ? nextSession : null;
  }

  async waitForConcurrentRefresh(row) {
    for (let attempt = 0; attempt < this.waitAttempts; attempt += 1) {
      await delay(this.waitMs);
      const current = await this.prisma.session.findUnique({
        where: { id: row.id },
      });
      if (!current) return undefined;
      if (current.revokedAt) {
        throw reauthorizationError("The Shopify offline token was invalidated");
      }
      if (current.tokenVersion !== row.tokenVersion)
        return rowToSession(current);
      if (
        !current.refreshLeaseExpires ||
        current.refreshLeaseExpires <= this.now()
      ) {
        return this.refreshOfflineSession(current, rowToSession(current));
      }
    }
    throw new ShopifyOfflineTokenRefreshError(
      "Another worker is still refreshing the Shopify offline token",
      {
        code: "offline_token_refresh_in_progress",
        status: 503,
        retryable: true,
      },
    );
  }

  async loadFreshRow(id) {
    const row = await this.prisma.session.findUnique({ where: { id } });
    if (!row || row.revokedAt) {
      throw reauthorizationError(
        "The Shopify offline token is no longer available",
      );
    }
    return rowToSession(row);
  }

  async releaseLease(id, tokenVersion, leaseId) {
    await this.prisma.session.updateMany({
      where: { id, tokenVersion, refreshLeaseId: leaseId },
      data: { refreshLeaseId: null, refreshLeaseExpires: null },
    });
  }

  async invalidateSession(id, tokenVersion, leaseId) {
    await this.prisma.session.updateMany({
      where: {
        id,
        tokenVersion,
        ...(leaseId ? { refreshLeaseId: leaseId } : {}),
      },
      data: {
        accessToken: "",
        refreshToken: null,
        expires: this.now(),
        refreshTokenExpires: this.now(),
        refreshLeaseId: null,
        refreshLeaseExpires: null,
        revokedAt: this.now(),
        tokenVersion: { increment: 1 },
      },
    });
  }
}

export async function requestOfflineTokenRefresh({
  fetchImpl,
  shop,
  refreshToken,
  apiKey,
  apiSecret,
  now = () => new Date(),
  timeoutMs = DEFAULT_REFRESH_TIMEOUT_MS,
}) {
  const canonicalShop = normalizeShopDomain(shop);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    const body = new URLSearchParams({
      client_id: apiKey,
      client_secret: apiSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    response = await fetchImpl(
      `https://${canonicalShop}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        redirect: "error",
        signal: controller.signal,
      },
    );
  } catch (cause) {
    throw new ShopifyOfflineTokenRefreshError(
      cause?.name === "AbortError"
        ? "Shopify offline token refresh timed out"
        : "Shopify offline token refresh could not reach Shopify",
      {
        code:
          cause?.name === "AbortError"
            ? "shopify_refresh_timeout"
            : "shopify_refresh_unreachable",
        status: cause?.name === "AbortError" ? 504 : 503,
        retryable: true,
        cause,
      },
    );
  } finally {
    clearTimeout(timeoutId);
  }

  const body = await readJson(response);
  if (!response.ok) {
    const description = String(body?.error_description || body?.error || "");
    const invalidRefreshToken =
      response.status === 401 &&
      body?.error === "invalid_request" &&
      /requires an active refresh_token/i.test(description);
    throw new ShopifyOfflineTokenRefreshError(
      invalidRefreshToken
        ? "Shopify rejected the offline refresh token"
        : "Shopify offline token refresh failed",
      {
        code: invalidRefreshToken
          ? "offline_refresh_token_invalid"
          : "shopify_refresh_rejected",
        status: invalidRefreshToken ? 401 : 502,
        retryable: !invalidRefreshToken,
        reauthorizationRequired: invalidRefreshToken,
      },
    );
  }

  const expiresIn = positiveSeconds(body?.expires_in, "expires_in");
  const refreshExpiresIn = positiveSeconds(
    body?.refresh_token_expires_in,
    "refresh_token_expires_in",
  );
  if (!body?.access_token || !body?.refresh_token) {
    throw new ShopifyOfflineTokenRefreshError(
      "Shopify returned an incomplete offline token response",
      {
        code: "shopify_refresh_response_invalid",
        status: 502,
        retryable: true,
      },
    );
  }

  const currentTime = now().getTime();
  return {
    accessToken: String(body.access_token),
    refreshToken: String(body.refresh_token),
    scope: typeof body.scope === "string" ? body.scope : undefined,
    expires: new Date(currentTime + expiresIn * 1000),
    refreshTokenExpires: new Date(currentTime + refreshExpiresIn * 1000),
  };
}

function sessionToRow(session) {
  const user = session.onlineAccessInfo?.associated_user;
  return {
    id: session.id,
    shop: session.shop,
    state: session.state,
    isOnline: session.isOnline,
    scope: session.scope || null,
    expires: session.expires || null,
    accessToken: session.accessToken ? encryptSecret(session.accessToken) : "",
    refreshToken: session.refreshToken
      ? encryptSecret(session.refreshToken)
      : null,
    refreshTokenExpires: session.refreshTokenExpires || null,
    userId: user?.id || null,
    firstName: user?.first_name || null,
    lastName: user?.last_name || null,
    email: user?.email || null,
    accountOwner: user?.account_owner || false,
    locale: user?.locale || null,
    collaborator: user?.collaborator || false,
    emailVerified: user?.email_verified || false,
  };
}

function rowToSession(row) {
  const session = new Session({
    id: row.id,
    shop: row.shop,
    state: row.state,
    isOnline: row.isOnline,
    scope: row.scope || undefined,
    expires: row.expires || undefined,
    accessToken: row.accessToken
      ? decryptStoredSecret(row.accessToken)
      : undefined,
    refreshToken: row.refreshToken
      ? decryptStoredSecret(row.refreshToken)
      : undefined,
    refreshTokenExpires: row.refreshTokenExpires || undefined,
    ...(row.isOnline
      ? {
          onlineAccessInfo: {
            associated_user: {
              id: Number(row.userId),
              first_name: row.firstName || "",
              last_name: row.lastName || "",
              email: row.email || "",
              account_owner: Boolean(row.accountOwner),
              locale: row.locale || "",
              collaborator: Boolean(row.collaborator),
              email_verified: Boolean(row.emailVerified),
            },
          },
        }
      : {}),
  });
  return session;
}

function decryptStoredSecret(value) {
  return value.startsWith("v1.") ? decryptSecret(value) : value;
}

function isLegacyStoredSecret(value) {
  return (
    typeof value === "string" && value.length > 0 && !value.startsWith("v1.")
  );
}

function shouldRefresh(session, now, refreshWindowMs) {
  return (
    !session.isOnline &&
    Boolean(session.expires) &&
    session.expires.getTime() - refreshWindowMs <= now.getTime()
  );
}

function isExpired(value, now) {
  return !value || value.getTime() <= now.getTime();
}

function reauthorizationError(message) {
  return new ShopifyOfflineTokenRefreshError(message, {
    code: "offline_token_reauthorization_required",
    status: 401,
    retryable: false,
    reauthorizationRequired: true,
  });
}

function normalizeRefreshError(error) {
  if (error instanceof ShopifyOfflineTokenRefreshError) return error;
  return new ShopifyOfflineTokenRefreshError(
    "Shopify offline token refresh failed",
    {
      code: "offline_token_refresh_failed",
      status: 503,
      retryable: true,
      cause: error,
    },
  );
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
}

function positiveSeconds(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ShopifyOfflineTokenRefreshError(
      `Shopify returned an invalid ${field}`,
      {
        code: "shopify_refresh_response_invalid",
        status: 502,
        retryable: true,
      },
    );
  }
  return parsed;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
