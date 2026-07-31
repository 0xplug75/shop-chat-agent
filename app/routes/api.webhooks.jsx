import { authenticate } from "../shopify.server";
import { createLogger } from "../lib/logger.server";
import { processWebhookOnce, WebhookPayloadError } from "../services/webhook.server";

export const action = async ({ request }) => {
  const requestId = crypto.randomUUID();
  const logger = createLogger({ requestId });

  try {
    const { shop, topic, webhookId, payload } = await authenticate.webhook(request);
    const result = await processWebhookOnce({
      webhookId,
      topic,
      shopDomain: shop,
      payload
    });

    logger.info("Shopify webhook processed", {
      topic,
      webhookId,
      duplicate: result.duplicate,
      handled: result.handled,
      manualFollowUp: result.manualFollowUp
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof Response) throw error;
    logger.error("Shopify webhook processing failed", { error });
    if (error instanceof WebhookPayloadError) {
      return Response.json({ error: "Invalid webhook payload", requestId }, { status: 400 });
    }
    return Response.json({ error: "Webhook could not be processed", requestId }, { status: 500 });
  }
};
