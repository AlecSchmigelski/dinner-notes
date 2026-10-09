// Generates the key pair that signs push notifications. Run once:
//   npm run vapid
import { b64url } from "../src/push.js";

const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = b64url(await crypto.subtle.exportKey("raw", publicKey));
const jwk = JSON.stringify(await crypto.subtle.exportKey("jwk", privateKey));

console.log(`VAPID_PUBLIC_KEY (paste into wrangler.toml [vars]):\n${pub}\n`);
console.log(`VAPID_PRIVATE_JWK (keep secret):\n${jwk}\n`);
console.log("Store the private key with:\n  npx wrangler secret put VAPID_PRIVATE_JWK\nand paste the JSON line above when asked.");
