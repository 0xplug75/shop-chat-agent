import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

export function encryptSecret(plaintext) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("Cannot encrypt an empty value");
  }

  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv, tag, ciphertext]
    .map((part) => typeof part === "string" ? part : part.toString("base64url"))
    .join(".");
}
export function decryptSecret(value) {
  if (typeof value !== "string") throw new Error("Invalid encrypted value");
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  if (version !== VERSION || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error("Invalid encrypted value");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(encodedIv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final()
  ]);

  return plaintext.toString("utf8");
}

function getEncryptionKey() {
  const configured = process.env.TOKEN_ENCRYPTION_KEY;
  if (!configured) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required");
  }

  const candidates = [
    () => Buffer.from(configured, "base64"),
    () => Buffer.from(configured, "hex"),
    () => Buffer.from(configured, "utf8")
  ];

  for (const toBuffer of candidates) {
    const key = toBuffer();
    if (key.length === 32) return key;
  }

  throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");
}
