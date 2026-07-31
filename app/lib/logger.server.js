const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(authorization|cookie|token|secret|password|verifier|checkouturl|databaseurl)/i;
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(baseContext = {}) {
  return {
    debug: (message, context) => write("debug", message, baseContext, context),
    info: (message, context) => write("info", message, baseContext, context),
    warn: (message, context) => write("warn", message, baseContext, context),
    error: (message, context) => write("error", message, baseContext, context)
  };
}

function write(level, message, baseContext, context) {
  const configuredLevel = String(process.env.LOG_LEVEL || "info").toLowerCase();
  if (LEVELS[level] < (LEVELS[configuredLevel] || LEVELS.info)) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...sanitize(baseContext),
    ...sanitize(context || {})
  };
  const output = JSON.stringify(entry);

  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.log(output);
}

function sanitize(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      code: value.code,
      status: value.status,
      message: sanitizeString(value.message)
    };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : sanitize(item, depth + 1)
    ])
  );
}

function sanitizeString(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/([?&](?:code|state|token|signature|hmac)=)[^&\s]+/gi, `$1${REDACTED}`)
    .slice(0, 4000);
}
