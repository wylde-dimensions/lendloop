// Request signing for the Convex <-> n8n integration, following the Standard
// Webhooks spec (https://www.standardwebhooks.com):
//
//   webhook-id:        unique message id (we use the event id, so it doubles as an idempotency key)
//   webhook-timestamp: unix seconds; anything outside ±5 minutes is rejected (replay window)
//   webhook-signature: "v1,<base64 HMAC-SHA256(secret, `${id}.${timestamp}.${body}`)>"
//                      several space-separated signatures are allowed, for key rotation
//
// Secrets use the spec's "whsec_<base64>" form. Each direction has its own
// secret, so a leaked n8n credential cannot forge Convex's events or vice versa.
// Pure Web Crypto: runs in the Convex runtime, in Node and in the test runner.

const encoder = new TextEncoder();
const SECRET_PREFIX = "whsec_";
export const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function secretBytes(secret: string): Uint8Array<ArrayBuffer> {
  return secret.startsWith(SECRET_PREFIX)
    ? base64ToBytes(secret.slice(SECRET_PREFIX.length))
    : encoder.encode(secret);
}

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", secretBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    usage,
  ]);
}

export async function sign(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const key = await hmacKey(secret, "sign");
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${id}.${timestamp}.${body}`));
  return `v1,${bytesToBase64(new Uint8Array(mac))}`;
}

export async function signedHeaders(
  secret: string,
  id: string,
  body: string,
  now: number = Date.now(),
): Promise<Record<"webhook-id" | "webhook-timestamp" | "webhook-signature", string>> {
  const timestamp = Math.floor(now / 1000).toString();
  return {
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": await sign(secret, id, timestamp, body),
  };
}

export type VerifyFailure = "missing_headers" | "bad_timestamp" | "stale_timestamp" | "bad_signature";

/**
 * Verify a signed request. Comparison happens inside crypto.subtle.verify, which
 * is constant-time, so the check doesn't leak how much of a signature matched.
 * `secrets` holds the current secret and, during a rotation, the previous one.
 */
export async function verify(params: {
  secrets: string[];
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  now?: number;
}): Promise<{ ok: true } | { ok: false; reason: VerifyFailure }> {
  const { secrets, id, timestamp, signature, body, now = Date.now() } = params;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "bad_timestamp" };
  if (Math.abs(now / 1000 - Number(timestamp)) > TIMESTAMP_TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const signed = encoder.encode(`${id}.${timestamp}.${body}`);
  const candidates: Uint8Array<ArrayBuffer>[] = [];
  for (const part of signature.split(" ")) {
    const [version, value] = part.split(",", 2);
    if (version !== "v1" || !value) continue;
    try {
      candidates.push(base64ToBytes(value));
    } catch {
      // Not base64: cannot match, ignore it.
    }
  }

  for (const secret of secrets) {
    const key = await hmacKey(secret, "verify");
    for (const candidate of candidates) {
      if (await crypto.subtle.verify("HMAC", key, candidate, signed)) return { ok: true };
    }
  }
  return { ok: false, reason: "bad_signature" };
}
