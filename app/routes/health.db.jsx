import prisma from "../db.server";
import { createLogger } from "../lib/logger.server";

export async function loader() {
  const requestId = crypto.randomUUID();
  const logger = createLogger({ requestId });

  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, database: "ready" }, {
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId }
    });
  } catch (error) {
    logger.error("Database readiness check failed", { error });
    return Response.json({ ok: false, database: "unavailable", requestId }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId }
    });
  }
}
