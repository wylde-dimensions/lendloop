import { describe, expect, test } from "vitest";
import { Webhook } from "standardwebhooks";
import { sign, signedHeaders, verify } from "../../convex/model/signing";

const now = Date.UTC(2026, 5, 10, 12);

describe("Standard Webhooks signing", () => {
  test("interoperates with the reference implementation in both directions", async () => {
    // The published example secret from the Standard Webhooks spec's test vectors. Not a real secret.
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const body = JSON.stringify({ test: 2432232314 });

    // Ours → reference verifier (which checks the timestamp against the real clock).
    const ours = await signedHeaders(secret, "msg_1", body, Date.now());
    const reference = new Webhook(secret);
    expect(() =>
      reference.verify(body, {
        "webhook-id": ours["webhook-id"],
        "webhook-timestamp": ours["webhook-timestamp"],
        "webhook-signature": ours["webhook-signature"],
      }),
    ).not.toThrow();

    // Reference signer → ours.
    const timestamp = new Date();
    const signature = reference.sign("msg_2", timestamp, body);
    const verdict = await verify({
      secrets: [secret],
      id: "msg_2",
      timestamp: Math.floor(timestamp.getTime() / 1000).toString(),
      signature,
      body,
    });
    expect(verdict).toEqual({ ok: true });
  });

  test("plain-string secrets (n8n Crypto credentials) are used as UTF-8 keys", async () => {
    const headers = await signedHeaders("plain secret", "msg_1", "{}", now);
    expect(headers["webhook-signature"]).toBe(
      await sign("plain secret", "msg_1", headers["webhook-timestamp"], "{}"),
    );
    expect(await verify({ secrets: ["plain secret"], ...asParams(headers), body: "{}", now })).toEqual({
      ok: true,
    });
  });

  test("rejects tampering, other keys, stale or future timestamps and junk", async () => {
    const headers = await signedHeaders("k", "msg_1", "{}", now);
    const check = (overrides: Partial<Parameters<typeof verify>[0]>) =>
      verify({ secrets: ["k"], ...asParams(headers), body: "{}", now, ...overrides });

    expect(await check({ body: '{"a":1}' })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await check({ id: "msg_2" })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await check({ secrets: ["other"] })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await check({ now: now + 6 * 60_000 })).toEqual({ ok: false, reason: "stale_timestamp" });
    expect(await check({ now: now - 6 * 60_000 })).toEqual({ ok: false, reason: "stale_timestamp" });
    expect(await check({ timestamp: "12abc" })).toEqual({ ok: false, reason: "bad_timestamp" });
    expect(await check({ signature: null })).toEqual({ ok: false, reason: "missing_headers" });
    expect(await check({ signature: "v1,not-base64!!" })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await check({ signature: headers["webhook-signature"].replace("v1,", "v2,") })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  test("accepts any one of several signatures, for rotation on the sending side", async () => {
    const headers = await signedHeaders("new", "msg_1", "{}", now);
    const old = await sign("old", "msg_1", headers["webhook-timestamp"], "{}");
    const both = `${old} ${headers["webhook-signature"]}`;
    expect(
      await verify({ secrets: ["new"], ...asParams(headers), signature: both, body: "{}", now }),
    ).toEqual({ ok: true });
    expect(
      await verify({ secrets: ["old"], ...asParams(headers), signature: both, body: "{}", now }),
    ).toEqual({ ok: true });
  });
});

function asParams(headers: Record<"webhook-id" | "webhook-timestamp" | "webhook-signature", string>) {
  return {
    id: headers["webhook-id"],
    timestamp: headers["webhook-timestamp"],
    signature: headers["webhook-signature"],
  };
}
