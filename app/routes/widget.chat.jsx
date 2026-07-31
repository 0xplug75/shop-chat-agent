import { authenticateAppProxyContext } from "../security/app-proxy-context.server";
import { handlePublicChatRequest } from "../services/chat-request.server";

export async function loader({ request }) {
  return handleProxyRequest(request);
}

export async function action({ request }) {
  return handleProxyRequest(request);
}

async function handleProxyRequest(request) {
  const { context } = await authenticateAppProxyContext(request);
  return handlePublicChatRequest({ request, context });
}
