import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  decryptToken,
  encryptToken,
  isEncryptedToken,
} from "../lib/crypto/google-token.ts";

/**
 * Refresh-token encryption.
 *
 * A decryption failure is silent in the worst way: every sync throws
 * before it reaches Google, the per-task error list swallows it, and
 * the UI reports a clean run. These tests use a throwaway key so they
 * cannot touch the real one.
 */

const REAL_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
const TEST_KEY = randomBytes(32).toString("base64");

beforeEach(() => {
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = TEST_KEY;
});
afterEach(() => {
  if (REAL_KEY === undefined) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = REAL_KEY;
});

describe("round trip", () => {
  it("returns the original refresh token", () => {
    const plain = "1//0gALcKRVt7Xa_test_refresh_token";
    assert.equal(decryptToken(encryptToken(plain)), plain);
  });

  it("never stores the token in the clear", () => {
    const plain = "1//0gALcKRVt7Xa_test_refresh_token";
    const stored = encryptToken(plain);
    assert.equal(stored.includes(plain), false);
    assert.notEqual(stored, plain);
  });

  it("produces a different ciphertext each time", () => {
    // AES-GCM with a fresh 12-byte IV; identical ciphertexts would
    // mean a fixed nonce.
    const plain = "same-token";
    assert.notEqual(encryptToken(plain), encryptToken(plain));
  });

  it("marks its output as encrypted", () => {
    assert.equal(isEncryptedToken(encryptToken("x")), true);
  });
});

describe("key handling", () => {
  it("accepts a base64 key", () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    assert.equal(decryptToken(encryptToken("tok")), "tok");
  });

  it("accepts a 64-character hex key", () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    assert.equal(decryptToken(encryptToken("tok")), "tok");
  });

  it("rejects a key that is not 32 bytes", () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = randomBytes(16).toString("base64");
    assert.throws(() => encryptToken("tok"), /32 bytes/);
  });

  it("fails loudly when the key is unset", () => {
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    assert.throws(() => encryptToken("tok"), /not set/);
  });

  it("cannot decrypt a token written under a different key", () => {
    // The rotation failure mode: every decrypt throws and the sync
    // silently does nothing.
    const stored = encryptToken("tok");
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    assert.throws(() => decryptToken(stored));
  });
});

describe("malformed input", () => {
  it("rejects a plaintext token that was never encrypted", () => {
    assert.equal(isEncryptedToken("1//0gALcKRVt7Xa"), false);
    assert.throws(() => decryptToken("1//0gALcKRVt7Xa"), /Unrecognised token format/);
  });

  it("rejects null and empty values", () => {
    for (const bad of [null, undefined, "", "v1:a:b:c:d"]) {
      assert.equal(isEncryptedToken(bad), false);
    }
    assert.throws(() => decryptToken(null as unknown as string));
  });

  it("rejects a tampered ciphertext", () => {
    const stored = encryptToken("tok");
    const parts = stored.split(":");
    parts[3] = Buffer.from("tampered").toString("base64url");
    assert.throws(() => decryptToken(parts.join(":")));
  });
});