import prisma from "../db.server";
import { normalizeShopDomain, normalizeStorefrontOrigin } from "../security/shopify-domain.server";

export async function getOrCreateShop({ shopDomain, shopifyShopId, storefrontOrigin }) {
  const normalizedDomain = normalizeShopDomain(shopDomain);
  const normalizedOrigin = normalizeStorefrontOrigin(storefrontOrigin);

  return prisma.shop.upsert({
    where: { shopDomain: normalizedDomain },
    create: {
      shopDomain: normalizedDomain,
      shopifyShopId: shopifyShopId ? String(shopifyShopId) : null,
      storefrontOrigin: normalizedOrigin,
      status: "ACTIVE"
    },
    update: {
      ...(shopifyShopId ? { shopifyShopId: String(shopifyShopId) } : {}),
      ...(normalizedOrigin ? { storefrontOrigin: normalizedOrigin } : {}),
      status: "ACTIVE",
      uninstalledAt: null
    }
  });
}
export async function getShopByDomain(shopDomain) {
  return prisma.shop.findUnique({
    where: { shopDomain: normalizeShopDomain(shopDomain) }
  });
}

export async function requireActiveShopById(shopId) {
  const shop = await prisma.shop.findFirst({
    where: { id: shopId, status: "ACTIVE" }
  });
  if (!shop) {
    const error = new Error("Shop is not active");
    error.status = 401;
    throw error;
  }
  return shop;
}

export async function markShopUninstalled(shopDomain) {
  const normalizedDomain = normalizeShopDomain(shopDomain);
  return prisma.shop.updateMany({
    where: { shopDomain: normalizedDomain },
    data: { status: "UNINSTALLED", uninstalledAt: new Date() }
  });
}
