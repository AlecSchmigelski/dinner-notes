// One-command setup: `npm run setup` from worker/.
// Logs in to Cloudflare, creates storage and push keys, deploys, asks for the
// secrets only a person should type, points the web app at the server and
// pushes that change. Safe to re-run: finished steps are skipped.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { b64url } from "../src/push.js";

const TOML = new URL("../wrangler.toml", import.meta.url);
const CONFIG = new URL("../../web/config.js", import.meta.url);

function wrangler(args, { input, quiet } = {}) {
  const r = spawnSync("npx", ["wrangler", ...args], {
    input,
    encoding: "utf8",
    stdio: [input === undefined ? "inherit" : "pipe", quiet ? "pipe" : "inherit", quiet ? "pipe" : "inherit"],
  });
  return { ok: r.status === 0, out: `${r.stdout || ""}${r.stderr || ""}` };
}

function capture(args) {
  const r = spawnSync("npx", ["wrangler", ...args], { encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout || ""}${r.stderr || ""}` };
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : "*".repeat(s.length ? 1 : 0));
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

const step = (n, msg) => console.log(`\n\x1b[1m${n}. ${msg}\x1b[0m`);
let toml = readFileSync(TOML, "utf8");

step(1, "Cloudflare login");
if (!capture(["whoami"]).out.includes("You are logged in")) {
  console.log("A browser window will open. Click Allow, then come back here.");
  if (!wrangler(["login"]).ok) process.exit(1);
} else console.log("Already logged in.");

step(2, "Storage for dinners and phones");
if (toml.includes("REPLACE_WITH_KV_NAMESPACE_ID")) {
  const r = capture(["kv", "namespace", "create", "STORE"]);
  const id = /id\s*=\s*"([0-9a-f]{32})"|"id":\s*"([0-9a-f]{32})"/.exec(r.out);
  if (!id) {
    console.error(r.out);
    process.exit(1);
  }
  toml = toml.replace("REPLACE_WITH_KV_NAMESPACE_ID", id[1] || id[2]);
  writeFileSync(TOML, toml);
  console.log("Created.");
} else console.log("Already set up.");

step(3, "Notification keys");
let newPrivateKey = null;
if (/VAPID_PUBLIC_KEY = ""/.test(toml)) {
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = b64url(await crypto.subtle.exportKey("raw", publicKey));
  newPrivateKey = JSON.stringify(await crypto.subtle.exportKey("jwk", privateKey));
  toml = toml.replace('VAPID_PUBLIC_KEY = ""', `VAPID_PUBLIC_KEY = "${pub}"`);
  writeFileSync(TOML, toml);
  console.log("Generated.");
} else console.log("Already set up.");

step(4, "Deploy the server");
const deploy = spawnSync("npx", ["wrangler", "deploy"], { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] });
process.stdout.write(deploy.stdout || "");
const url = /https:\/\/[\w.-]+\.workers\.dev/.exec(deploy.stdout || "")?.[0];
if (deploy.status !== 0 || !url) {
  console.error("Deploy failed. Fix the error above and run `npm run setup` again.");
  process.exit(1);
}

step(5, "Secrets (never stored in the repo)");
const listed = capture(["secret", "list", "--format", "json"]);
let have = [];
try {
  have = JSON.parse(listed.out.slice(listed.out.indexOf("["))).map((s) => s.name);
} catch {
  // First run: nothing set yet.
}
const put = (name, value) => {
  if (!wrangler(["secret", "put", name], { input: value, quiet: true }).ok) {
    console.error(`Couldn't save ${name}. Run \`npm run setup\` again.`);
    process.exit(1);
  }
  console.log(`  saved ${name}`);
};

if (newPrivateKey || !have.includes("VAPID_PRIVATE_JWK")) {
  if (!newPrivateKey) {
    console.error("The notification private key is missing. Clear VAPID_PUBLIC_KEY in wrangler.toml and re-run.");
    process.exit(1);
  }
  put("VAPID_PRIVATE_JWK", newPrivateKey);
}
const prompts = [
  ["VAPID_SUBJECT", "Your email (Apple and Google's contact for notifications): ", (v) => (v.startsWith("mailto:") ? v : `mailto:${v}`)],
  ["CALENDAR_URL", "Calendar share link (starts with webcal://): ", (v) => v],
  ["ANTHROPIC_API_KEY", "Anthropic API key (from console.anthropic.com, typing is hidden): ", (v) => v, true],
  ["APP_PASSCODE", "Pick a passcode she'll type once on her phone: ", (v) => v],
];
let passcode = "";
for (const [name, question, shape, hidden] of prompts) {
  if (have.includes(name)) {
    console.log(`  ${name} already set`);
    continue;
  }
  let value = "";
  while (!value) value = await ask(question, { hidden });
  if (name === "APP_PASSCODE") passcode = value;
  put(name, shape(value));
}

step(6, "Point the app at the server");
const config = readFileSync(CONFIG, "utf8");
if (!config.includes(`apiUrl: "${url}"`)) {
  writeFileSync(CONFIG, config.replace(/apiUrl: "[^"]*"/, `apiUrl: "${url}"`));
  const git = (...a) => spawnSync("git", a, { cwd: new URL("../..", import.meta.url), stdio: "inherit" }).status === 0;
  if (git("add", "web/config.js", "worker/wrangler.toml") && git("commit", "-m", "Connect the app to the deployed server") && git("push")) {
    console.log("Pushed. GitHub Pages updates in about a minute.");
  } else {
    console.log("Couldn't push automatically. Commit and push web/config.js and worker/wrangler.toml yourself.");
  }
} else console.log("Already pointed at " + url);

console.log(`\n\x1b[1mDone.\x1b[0m Server: ${url}`);
if (passcode) console.log(`Her passcode: ${passcode}`);
console.log("Next: open the app on her iPhone in Safari, Share → Add to Home Screen.");
