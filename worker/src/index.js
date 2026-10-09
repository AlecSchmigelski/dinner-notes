import Anthropic from "@anthropic-ai/sdk";
import { fetchCalendar, parseEvents, findDinners } from "./calendar.js";
import { sendPush } from "./push.js";

// The app's only server. It holds the secrets the phone must never see (the
// API key, the calendar link, the push signing key) and does three jobs:
//   POST /draft      her answers and notes in, a draft in her voice out
//   GET  /dinners    reservations found on her calendar
//   POST /subscribe  remember her phone for "How was it?" notifications
// plus a cron that re-reads the calendar and sends those notifications.

const LOOKBACK_DAYS = 7; // older dinners are too stale to ask about
const ASK_AFTER_MIN = 30; // minutes after a reservation ends
const ASK_WITHIN_H = 6; // after this, skip the notification; it still shows in the app

const LENGTHS = {
  short: "25 to 45 words. One or two punchy sentences.",
  base: "55 to 85 words.",
  long: "100 to 140 words. Room for a tip or a detail worth remembering.",
};

const SYSTEM = `You write restaurant reviews for Beli, the restaurant-ranking app, in the voice of the person who ate there.

You get her answers to a few tap-to-pick questions (overall verdict, vibe, food, service, value, occasion, whether she'd go back), her favorite dishes, and her own notes, typed or dictated right after the meal. The notes are the most important input: they are her actual words. Keep her phrasing, slang and enthusiasm, and cut filler and false starts.

Rules:
- First person, past tense for the visit, the way someone texts a friend about dinner. Warm, specific, never like a press release.
- Use only what she gave you. Never invent a dish, a detail, a price, a person or an opinion. If she skipped a question, don't cover that topic.
- Weave the picked answers into natural sentences rather than listing them ("cozy and a little romantic", not "Vibe: cozy, romantic").
- Name her favorite dishes. If her notes mention something to skip, include it.
- No hashtags, no emoji, no star ratings, no title. Output only the review text.
- Respect the requested length.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["draft"],
  properties: { draft: { type: "string" } },
};

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1|[\w.-]+\.local)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0] || "",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-passcode",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "content-type": "application/json" },
  });
}

const str = (v, max) => String(v ?? "").trim().slice(0, max);
const list = (v) => (Array.isArray(v) ? v.map((x) => str(x, 60)).filter(Boolean).slice(0, 12) : []);

function buildPrompt(b) {
  const a = b.answers && typeof b.answers === "object" ? b.answers : {};
  const lines = [
    ["Overall", str(a.overall, 40)],
    ["Vibe", list(a.vibe).join(", ")],
    ["Food", list(a.food).join(", ")],
    ["Service", list(a.service).join(", ")],
    ["Value", list(a.value).join(", ")],
    ["Occasion", list(a.occasion).join(", ")],
    ["Would go back", str(a.goBack, 40)],
  ].filter(([, v]) => v);

  const parts = [];
  const samples = str(b.samples, 3000);
  if (samples) parts.push(`<her_past_reviews>\nMatch this voice.\n${samples}\n</her_past_reviews>`);
  parts.push(
    `<dinner>\nRestaurant: ${str(b.restaurant, 120) || "unknown"}` +
      (str(b.neighborhood, 80) ? `\nNeighborhood: ${str(b.neighborhood, 80)}` : "") +
      (str(b.date, 60) ? `\nDate: ${str(b.date, 60)}` : "") +
      `\n</dinner>`,
  );
  parts.push(`<her_answers>\n${lines.map(([k, v]) => `${k}: ${v}`).join("\n") || "(skipped all questions)"}\n</her_answers>`);
  const dishes = list(b.dishes);
  if (dishes.length) parts.push(`<favorite_dishes>${dishes.join(", ")}</favorite_dishes>`);
  const notes = str(b.notes, 6000);
  if (notes) parts.push(`<her_notes>\n${notes}\n</her_notes>`);

  const length = LENGTHS[b.length] ? b.length : "base";
  parts.push(`Length: ${LENGTHS[length]}`);

  const previous = str(b.previous, 2000);
  if (previous) {
    parts.push(
      `<previous_draft>\n${previous}\n</previous_draft>\n` +
        (b.mode === "redo"
          ? "She wants a fresh take: same facts and length, different wording and structure."
          : "Rewrite it to the new length, keeping her voice and the best lines."),
    );
  }
  return parts.join("\n\n");
}

// ---------- calendar + push ----------

async function readStore(env, key, fallback) {
  return (await env.STORE.get(key, "json")) ?? fallback;
}

// Re-reads the calendar and keeps the recent dinners, carrying over which
// ones have already been notified.
async function syncDinners(env) {
  const known = await readStore(env, "dinners", []);
  const notified = new Set(known.filter((d) => d.notified).map((d) => d.id));
  const now = Date.now();
  const events = parseEvents(await fetchCalendar(env.CALENDAR_URL), env.DEFAULT_TZ);
  const dinners = findDinners(events)
    .filter((d) => Date.parse(d.datetime) > now - LOOKBACK_DAYS * 864e5 && Date.parse(d.datetime) < now + 2 * 864e5)
    .map((d) => ({ ...d, notified: notified.has(d.id) }));
  await env.STORE.put("dinners", JSON.stringify(dinners));
  await env.STORE.put("syncedAt", String(now));
  return dinners;
}

async function notifyFinished(env, dinners) {
  const now = Date.now();
  const due = dinners.filter((d) => {
    const since = now - Date.parse(d.end);
    return !d.notified && since >= ASK_AFTER_MIN * 60e3 && since < ASK_WITHIN_H * 3600e3;
  });
  if (!due.length) return;

  let subs = await readStore(env, "subs", []);
  const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), subject: env.VAPID_SUBJECT };
  const dead = new Set();
  for (const d of due) {
    for (const sub of subs) {
      try {
        const status = await sendPush(sub, { title: `How was ${d.restaurant}?`, body: "A few taps and Alec will write it up.", url: `./?dinner=${encodeURIComponent(d.id)}`, tag: d.id }, vapid);
        if (status === 404 || status === 410) dead.add(sub.endpoint);
      } catch {
        // One bad subscription shouldn't stop the others.
      }
    }
    d.notified = true;
  }
  if (dead.size) {
    subs = subs.filter((s) => !dead.has(s.endpoint));
    await env.STORE.put("subs", JSON.stringify(subs));
  }
  await env.STORE.put("dinners", JSON.stringify(dinners));
}

async function handleDinners(env, headers) {
  if (!env.CALENDAR_URL) return json({ dinners: [], vapidPublicKey: env.VAPID_PUBLIC_KEY || "" }, 200, headers);
  let dinners = await readStore(env, "dinners", []);
  const syncedAt = Number(await env.STORE.get("syncedAt")) || 0;
  if (Date.now() - syncedAt > 10 * 60e3) {
    try {
      dinners = await syncDinners(env);
    } catch {
      // Serve the last good copy if iCloud is slow or down.
    }
  }
  // Only dinners that have started: you can't review a meal you haven't had.
  const started = dinners.filter((d) => Date.parse(d.datetime) <= Date.now()).map(({ notified, ...d }) => d);
  return json({ dinners: started, vapidPublicKey: env.VAPID_PUBLIC_KEY || "" }, 200, headers);
}

async function handleSubscribe(request, env, headers) {
  const sub = await request.json().catch(() => null);
  const valid =
    sub && typeof sub.endpoint === "string" && /^https:\/\//.test(sub.endpoint) &&
    typeof sub.keys?.p256dh === "string" && typeof sub.keys?.auth === "string";
  if (!valid) return json({ error: "Bad subscription" }, 400, headers);
  const subs = (await readStore(env, "subs", [])).filter((s) => s.endpoint !== sub.endpoint);
  subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
  await env.STORE.put("subs", JSON.stringify(subs.slice(-10)));
  return json({ ok: true }, 200, headers);
}

// ---------- draft ----------

async function handleDraft(request, env, headers) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request" }, 400, headers);
  }
  if (!body || typeof body !== "object") return json({ error: "Bad request" }, 400, headers);

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt(body) }],
    });

    if (response.stop_reason === "refusal") {
      return json({ error: "Couldn't write that one. Try again." }, 422, headers);
    }
    if (response.stop_reason === "max_tokens") {
      return json({ error: "That ran long. Try again." }, 422, headers);
    }
    const text = response.content.find((b) => b.type === "text")?.text;
    const draft = JSON.parse(text).draft?.trim();
    if (!draft) return json({ error: "Came back empty. Try again." }, 502, headers);
    return json({ draft }, 200, headers);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return json({ error: "Busy right now. Try again in a minute." }, 429, headers);
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return json({ error: "The server's API key is wrong." }, 500, headers);
    }
    if (error instanceof Anthropic.APIError) {
      return json({ error: `Couldn't reach Claude (${error.status}). Try again.` }, 502, headers);
    }
    if (error instanceof SyntaxError) {
      return json({ error: "Got a garbled answer back. Try again." }, 502, headers);
    }
    return json({ error: "Something went wrong. Try again." }, 500, headers);
  }
}

export default {
  async fetch(request, env) {
    const headers = cors(request.headers.get("Origin") || "", env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    // A shared passcode keeps strangers who find the URL from spending the key
    // or reading her dinners.
    if (!env.APP_PASSCODE || request.headers.get("x-passcode") !== env.APP_PASSCODE) {
      return json({ error: "passcode" }, 401, headers);
    }

    const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    if (request.method === "GET" && path === "/dinners") return handleDinners(env, headers);
    if (request.method === "POST" && path === "/subscribe") return handleSubscribe(request, env, headers);
    if (request.method === "POST" && (path === "/draft" || path === "/")) return handleDraft(request, env, headers);
    return json({ error: "Not found" }, 404, headers);
  },

  async scheduled(_event, env, ctx) {
    if (!env.CALENDAR_URL) return;
    ctx.waitUntil(syncDinners(env).then((dinners) => notifyFinished(env, dinners)));
  },
};
