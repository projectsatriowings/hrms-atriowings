import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Application-level encryption for Employee.bankDetails (AES-256-GCM).
 *
 * Format: `enc:v1:<iv base64>:<auth tag base64>:<ciphertext base64>`.
 * The plaintext is the JSON string of the bankDetails object. The key comes
 * from env BANK_ENCRYPTION_KEY as 64 hex chars (32 bytes). In production a
 * missing/invalid key fails startup (see app.module.ts); at use-time a
 * missing/invalid key throws rather than silently storing plaintext.
 *
 * Legacy rows: bankDetails stored as a plain JSON object (pre-encryption)
 * are NOT plaintext strings — they are detected by type (object, no `enc:v1:`
 * prefix) and encrypted on read-back by the detail endpoint.
 */
const PREFIX = "enc:v1:";

function getKey(): Buffer {
  const hex = process.env.BANK_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("BANK_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters");
  }
  return Buffer.from(hex, "hex");
}

export function isEncryptedBankDetails(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptBankDetails(value: unknown): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptBankDetails(stored: unknown): unknown {
  if (!isEncryptedBankDetails(stored)) return stored;
  const key = getKey();
  // NOTE: strip the "enc:v1:" prefix first — splitting the whole string on
  // ":" would misalign parts, because the prefix itself contains a colon.
  const [ivB64, tagB64, ctB64] = (stored as string).slice(PREFIX.length).split(":");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}
