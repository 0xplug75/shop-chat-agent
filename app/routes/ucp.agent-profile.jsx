import {
  UCP_CAPABILITIES,
  UCP_VERSION,
} from "../services/commerce/ucp-client.server";

export async function loader() {
  const capabilities = {
    [UCP_CAPABILITIES.catalogSearch]: [{ version: UCP_VERSION }],
    [UCP_CAPABILITIES.catalogLookup]: [{ version: UCP_VERSION }],
    [UCP_CAPABILITIES.cart]: [{ version: UCP_VERSION }],
    ...(global.process?.env?.UCP_CHECKOUT_ENABLED === "true"
      ? { [UCP_CAPABILITIES.checkout]: [{ version: UCP_VERSION }] }
      : {}),
  };

  return Response.json(
    {
      ucp: {
        version: UCP_VERSION,
        capabilities,
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=300",
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );
}

export async function action() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
