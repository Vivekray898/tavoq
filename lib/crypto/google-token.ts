/**
 * AES-256-GCM encryption for Google OAuth refresh tokens.
 *
 * A refresh token is a long-lived credential that grants full access
 * to a user's calendar. Storing it as plaintext in a table that the
 * app can read would mean a single SQL injection or leaked anon key
 * exposes every connected account — so the value in
 * user_google_tokens.refresh_token is always a ciphertext produced
 * here.
 *
 * Key: GOOGLE_TOKEN_ENCRYPTION_KEY — 32 bytes, base64 or hex.
 * Rotate by re-encrypting: the version prefix ("v1:") leaves room for
 * a future "v2:" to decrypt the old format during a migration.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12; // 96-bit nonce, the GCM standard

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64url");
}

function b64urlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function readKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "GOOGLE_TOKEN_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32"
    );
  }

  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }

  if (key.length !== 32) {
    throw new Error(
      `GOOGLE_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length})`
    );
  }
  return key;
}

/** Encrypt a refresh token for storage. Format: v1:<iv>:<tag>:<ciphertext> */
export function encryptToken(plaintext: string): string {
  const key = readKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    b64urlEncode(iv),
    b64urlEncode(tag),
    b64urlEncode(ciphertext),
  ].join(":");
}

/** Decrypt a stored token. Throws if the value is malformed or tampered. */
export function decryptToken(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Unrecognised token format — expected v1:<iv>:<tag>:<ciphertext>");
  }

  const [, ivRaw, tagRaw, ciphertextRaw] = parts;
  const key = readKey();
  const decipher = createDecipheriv(ALGORITHM, key, b64urlDecode(ivRaw));
  decipher.setAuthTag(b64urlDecode(tagRaw));
  return Buffer.concat([
    decipher.update(b64urlDecode(ciphertextRaw)),
    decipher.final(),
  ]).toString("utf8");
}

/** True when the value looks like something we produced. */
export function isEncryptedToken(value: string | null | undefined): boolean {
  return !!value && value.startsWith(`${VERSION}:`) && value.split(":").length === 4;
}
