import { authenticateAppProxyContext } from "../security/app-proxy-context.server";
import { requireWidgetRequestContext } from "../security/merchant-context.server";
import { WidgetTokenError } from "../security/widget-token.server";
import { handlePublicCommerceRequest } from "../services/commerce-request.server";
import {
  readJsonBodyWithLimit,
  RequestTooLargeError,
} from "../services/chat-request.server";

const MAX_COMMERCE_BYTES = 32 * 1024;

export async function loader() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

export async function action({ request }) {
  const proxy = await authenticateAppProxyContext(request);
  let body;
  try {
    body = await readJsonBodyWithLimit(request, MAX_COMMERCE_BYTES);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof RequestTooLargeError
            ? "Request is too large"
            : "Invalid JSON request",
      },
      { status: error instanceof RequestTooLargeError ? 413 : 400 },
    );
  }

  const token = body?.widget_token;
  const commerceBody =
    body && typeof body === "object" && !Array.isArray(body) ? { ...body } : {};
  delete commerceBody.widget_token;
  try {
    const context = requireWidgetRequestContext(request, {
      token,
      expectedContext: proxy.context,
      verifyOrigin: false,
    });
    return handlePublicCommerceRequest({ context, rawBody: commerceBody });
  } catch (error) {
    if (error instanceof WidgetTokenError) {
      return Response.json(
        { error: "Unauthorized", requestId: proxy.context.requestId },
        {
          status: 401,
          headers: { "X-Request-Id": proxy.context.requestId },
        },
      );
    }
    throw error;
  }
}
