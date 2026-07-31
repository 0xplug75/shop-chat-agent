/* eslint-env node */

import { OAuthCallbackQuerySchema, formatZodError } from "../contracts/commerce.schemas.server";
import { consumeOAuthState, OAuthStateError } from "../services/oauth-state.server";
import { getCustomerAccountUrls } from "../services/customer-account-urls.server";
import { storeCustomerToken } from "../services/customer-token.server";
import { createMerchantRequestContext } from "../security/merchant-context.server";
import { assertTrustedShopifyUrl } from "../security/shopify-domain.server";
import { fetchWithTimeout } from "../lib/fetch-with-timeout.server";
import { createLogger } from "../lib/logger.server";

export async function loader({ request }) {
  const requestId = crypto.randomUUID();
  const logger = createLogger({ requestId });
  const parsed = OAuthCallbackQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );

  if (!parsed.success) {
    logger.warn("Customer OAuth callback rejected", { validation: formatZodError(parsed.error) });
    return jsonError("Invalid authorization callback", 400, requestId);
  }

  try {
    const state = await consumeOAuthState(parsed.data.state);
    const context = createMerchantRequestContext({
      shopId: state.shopId,
      shopDomain: state.shop.shopDomain,
      conversationId: state.conversationId,
      requestId
    });
    const accountUrls = await getCustomerAccountUrls(context, state.conversationId);
    if (!accountUrls?.tokenUrl || !state.codeVerifier || !state.redirectUri) {
      throw new Error("Customer OAuth context is incomplete");
    }

    const tokenResponse = await exchangeCodeForToken({
      code: parsed.data.code,
      codeVerifier: state.codeVerifier,
      redirectUri: state.redirectUri,
      tokenUrl: accountUrls.tokenUrl,
      shopDomain: context.shopDomain
    });
    const expiresIn = Math.max(Number(tokenResponse.expires_in || 0), 60);
    const customerReference = String(
      tokenResponse.customer_id || tokenResponse.sub || `conversation:${state.conversationId}`
    );

    await storeCustomerToken(context, {
      conversationId: state.conversationId,
      customerReference,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: new Date(Date.now() + expiresIn * 1000)
    });

    logger.info("Customer OAuth completed", {
      shopId: context.shopId,
      conversationId: state.conversationId
    });
    return successHtml();
  } catch (error) {
    logger.warn("Customer OAuth failed", { error });
    const status = error instanceof OAuthStateError ? 400 : 502;
    return jsonError("Customer authorization could not be completed", status, requestId);
  }
}

async function exchangeCodeForToken({ code, codeVerifier, redirectUri, tokenUrl, shopDomain }) {
  const clientId = process.env.SHOPIFY_API_KEY;
  if (!clientId) throw new Error("SHOPIFY_API_KEY is required");
  const trustedTokenUrl = assertTrustedShopifyUrl(tokenUrl, { shopDomain });
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier
  });
  const response = await fetchWithTimeout(trustedTokenUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  }, 15_000);

  if (!response.ok) {
    const error = new Error("Customer token exchange was rejected");
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  if (!payload?.access_token) throw new Error("Customer token response was invalid");
  return payload;
}

function jsonError(message, status, requestId) {
  return Response.json({ error: message, requestId }, { status });
}

function successHtml() {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authentication successful</title></head>
<body><main><h1>Authentication successful</h1><p>You can return to the store.</p></main><script>setTimeout(function(){window.close()},800)</script></body></html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "Cache-Control": "no-store"
    }
  });
}
