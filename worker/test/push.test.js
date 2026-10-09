import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptPayload, sendPush, b64url, fromB64url } from "../src/push.js";

const enc = new TextEncoder();

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

// What the browser does on receipt (RFC 8291 §3, from the user agent's side).
async function browserDecrypt(body, ua) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...ua.publicRaw, ...asPublic]);
  const ikm = await hkdf(ua.auth, ecdh, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, ciphertext));
  let end = padded.length - 1;
  while (padded[end] === 0) end--;
  assert.equal(padded[end], 2, "last-record delimiter");
  return new TextDecoder().decode(padded.slice(0, end));
}

async function fakeBrowser() {
  const keys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    privateKey: keys.privateKey,
    publicRaw,
    auth,
    subscription: { endpoint: "https://web.push.apple.com/abc123", keys: { p256dh: b64url(publicRaw), auth: b64url(auth) } },
  };
}

test("a browser can decrypt the payload", async () => {
  const ua = await fakeBrowser();
  const message = JSON.stringify({ title: "How was Lilia?", url: "./?dinner=x" });
  const body = await encryptPayload(ua.subscription, message);
  assert.equal(new DataView(body.buffer).getUint32(16), 4096);
  assert.equal(await browserDecrypt(body, ua), message);
});

test("sendPush signs a VAPID JWT the push service can verify", async () => {
  const ua = await fakeBrowser();
  const signing = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const vapid = {
    publicKey: b64url(await crypto.subtle.exportKey("raw", signing.publicKey)),
    privateJwk: await crypto.subtle.exportKey("jwk", signing.privateKey),
    subject: "mailto:test@example.com",
  };

  let seen;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen = { url, init };
    return new Response(null, { status: 201 });
  };
  try {
    assert.equal(await sendPush(ua.subscription, { title: "hi" }, vapid), 201);
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(seen.url, ua.subscription.endpoint);
  assert.equal(seen.init.headers["Content-Encoding"], "aes128gcm");
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(seen.init.headers.Authorization);
  assert.ok(m, "vapid header shape");
  assert.equal(m[2], vapid.publicKey);

  const [h, c, s] = m[1].split(".");
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(c)));
  assert.equal(claims.aud, "https://web.push.apple.com");
  assert.equal(claims.sub, "mailto:test@example.com");
  assert.ok(claims.exp > Date.now() / 1000);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, signing.publicKey, fromB64url(s), enc.encode(`${h}.${c}`));
  assert.ok(ok, "JWT signature verifies");
  assert.equal(await browserDecrypt(new Uint8Array(seen.init.body), ua), JSON.stringify({ title: "hi" }));
});
