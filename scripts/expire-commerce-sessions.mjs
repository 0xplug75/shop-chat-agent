import prisma from "../app/db.server.js";
import { expireStaleCommerceSessions } from "../app/services/commerce-session.server.js";

try {
  const result = await expireStaleCommerceSessions();
  process.stdout.write(`${JSON.stringify({ ok: true, expired: result.count })}\n`);
} catch (_error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: "Session expiration failed" })}\n`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
