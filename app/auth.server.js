import { createHash, randomBytes } from "node:crypto";
import { createOAuthState } from "./services/oauth-state.server";
import { getCustomerAccountUrls } from "./services/customer-account-urls.server";
import { assertTrustedShopifyUrl } from "./security/shopify-domain.server";
import { resolveRuntimeUrls } from "./config/runtime-urls";

export async function generateAuthUrl(context, conversationId) {
  if (!context?.shopId || !conversationId) {
    throw new Error("Merchant context and conversation are required");
  }

  const clientId = process.env.SHOPIFY_API_KEY;
  const redirectUri = getRedirectUri();
  if (!clientId) throw new Error("SHOPIFY_API_KEY is required");

  const accountUrls = await getCustomerAccountUrls(context, conversationId);
  if (!accountUrls?.authorizationUrl) {
    throw new Error("Customer account authorization is unavailable");
  }

  const authorizationUrl = assertTrustedShopifyUrl(
    accountUrls.authorizationUrl,
    {
      shopDomain: context.shopDomain,
    },
  );
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const { state } = await createOAuthState(context, {
    conversationId,
    codeVerifier: verifier,
    redirectUri,
  });

  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("scope", "customer-account-mcp-api:full");
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  return {
    url: authorizationUrl.toString(),
    conversation_id: conversationId,
  };
}

export function generateCodeVerifier() {
  return randomBytes(32).toString("base64url");
}

export async function generateCodeChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function getRedirectUri() {
  return resolveRuntimeUrls().customerOAuthRedirectUrl;
}
