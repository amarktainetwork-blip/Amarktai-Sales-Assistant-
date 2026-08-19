import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedSecret = {
  keyVersion: string;
  iv: string;
  authTag: string;
  ciphertext: string;
};

function masterKey() {
  const encoded = process.env.CONNECTION_SECRETS_MASTER_KEY?.trim();
  if (!encoded) throw new Error("CONNECTION_SECRETS_MASTER_KEY must be configured before CRM secrets can be stored.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("CONNECTION_SECRETS_MASTER_KEY must be a base64-encoded 32-byte key.");
  return key;
}

function keyVersion() {
  return process.env.CONNECTION_SECRETS_KEY_VERSION?.trim() || "v1";
}

/**
 * Encrypts a JSON payload with AES-256-GCM. The returned envelope is designed
 * for database storage; plaintext values must never be logged or returned from
 * tRPC procedures.
 */
export function encryptConnectionSecret(payload: Record<string, unknown>): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const serialized = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(serialized), cipher.final()]);
  return {
    keyVersion: keyVersion(),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptConnectionSecret<T extends Record<string, unknown>>(envelope: EncryptedSecret): T {
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  const serialized = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(serialized) as T;
}

/** Avoid accidental persistence of OAuth credentials in evidence and logs. */
export function redactConnectionSecret<T extends Record<string, unknown>>(payload: T) {
  const sensitive = /token|secret|password|authorization|cookie|credential/i;
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, sensitive.test(key) ? "[REDACTED]" : value]));
}
