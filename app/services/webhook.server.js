import { z } from "zod";
import prisma from "../db.server";
import { normalizeShopDomain } from "../security/shopify-domain.server";

const CustomerPrivacyPayloadSchema = z.object({
  shop_id: z.union([z.string(), z.number()]).optional(),
  shop_domain: z.string().optional(),
  customer: z.object({
    id: z.union([z.string(), z.number()])
  }).passthrough()
}).passthrough();

const ShopPrivacyPayloadSchema = z.object({
  shop_id: z.union([z.string(), z.number()]).optional(),
  shop_domain: z.string().optional()
}).passthrough();

export class WebhookPayloadError extends Error {
  constructor() {
    super("Invalid webhook payload");
    this.name = "WebhookPayloadError";
    this.status = 400;
  }
}

export async function processWebhookOnce({ webhookId, topic, shopDomain, payload }) {
  if (!webhookId || !topic) throw new WebhookPayloadError();
  const normalizedDomain = normalizeShopDomain(shopDomain);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const shop = await tx.shop.findUnique({
        where: { shopDomain: normalizedDomain },
        select: { id: true }
      });

      await tx.webhookReceipt.create({
        data: {
          webhookId,
          shopId: shop?.id || null,
          shopDomain: normalizedDomain,
          topic
        }
      });

      const details = await processTopic(tx, {
        topic,
        shopId: shop?.id,
        shopDomain: normalizedDomain,
        payload
      });

      return { duplicate: false, ...details };
    });

    return result;
  } catch (error) {
    if (error?.code === "P2002") return { duplicate: true, handled: true };
    throw error;
  }
}

async function processTopic(tx, { topic, shopId, shopDomain, payload }) {
  switch (topic) {
    case "APP_UNINSTALLED":
      if (shopId) {
        await tx.shop.update({
          where: { id: shopId },
          data: { status: "UNINSTALLED", uninstalledAt: new Date() }
        });
      }
      await tx.session.deleteMany({ where: { shop: shopDomain } });
      return { handled: true };

    case "CUSTOMERS_DATA_REQUEST":
      parseCustomerPayload(payload);
      // The receipt is the audit record. Data export remains a documented
      // merchant-support operation because no PII is copied into a job table.
      return { handled: true, manualFollowUp: true };

    case "CUSTOMERS_REDACT":
      if (shopId) await redactCustomer(tx, shopId, parseCustomerPayload(payload));
      return { handled: true };

    case "SHOP_REDACT":
      if (!ShopPrivacyPayloadSchema.safeParse(payload).success) {
        throw new WebhookPayloadError();
      }
      await tx.session.deleteMany({ where: { shop: shopDomain } });
      if (shopId) await tx.shop.delete({ where: { id: shopId } });
      return { handled: true };

    default:
      return { handled: false };
  }
}

function parseCustomerPayload(payload) {
  const parsed = CustomerPrivacyPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new WebhookPayloadError();
  return parsed.data;
}

async function redactCustomer(tx, shopId, payload) {
  const customerId = String(payload.customer.id);
  const references = [customerId, `gid://shopify/Customer/${customerId}`];
  const tokens = await tx.customerToken.findMany({
    where: { shopId, customerReference: { in: references } },
    select: { conversationId: true }
  });
  const conversationIds = tokens
    .map((token) => token.conversationId)
    .filter(Boolean);

  await tx.customerToken.deleteMany({
    where: { shopId, customerReference: { in: references } }
  });

  await tx.conversation.deleteMany({
    where: {
      shopId,
      OR: [
        { customerId: { in: references } },
        ...(conversationIds.length > 0 ? [{ id: { in: conversationIds } }] : [])
      ]
    }
  });

  await tx.commerceSession.updateMany({
    where: { shopId, customerId: { in: references } },
    data: { customerId: null, buyerContext: {}, version: { increment: 1 } }
  });
}
