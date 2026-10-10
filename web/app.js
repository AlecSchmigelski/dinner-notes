"use strict";

// Dinner Notes. One question per screen, then notes, then a draft in her voice
// to paste into Beli. Every screen is a function of `state`, rendered into #app;
// clicks are delegated through data-act attributes.

// ---------- config ----------
const CONFIG = window.DINNER_NOTES || {};
const demo = new URLSearchParams(location.search).has("demo");

const QUESTIONS = [
  { key: "overall", title: "How was it overall?", single: true, options: ["Loved it", "It was fine", "Didn't like it"] },
  { key: "vibe", title: "What was the vibe?", options: ["Cozy", "Lively", "Romantic", "Casual", "Loud"] },
  { key: "food", title: "How was the food?", options: ["Inventive", "Comforting", "Perfectly cooked", "Bland"] },
  { key: "service", title: "How was the service?", options: ["Warm", "Attentive", "Slow"] },
  { key: "value", title: "Was it worth it?", options: ["Steal", "Fair", "Pricey but worth it", "Overpriced"] },
  { key: "occasion", title: "What was the occasion?", options: ["Date night", "Friends", "Family", "Solo", "Work"] },
  { key: "goBack", title: "Would you go back?", single: true, options: ["Definitely", "Maybe", "No"] },
];
const VERDICT_CLASS = { "Loved it": "", "It was fine": "fine", "Didn't like it": "no" };
const LENGTHS = ["short", "base", "long"];

// ---------- storage ----------
const KEY = "dinner-notes/v1";

function blankAnswers() {
  return { overall: null, vibe: [], food: [], service: [], value: [], occasion: [], goBack: null };
}

function cleanDinner(d) {
  if (!d || typeof d !== "object" || typeof d.id !== "string") return null;
  const a = d.answers && typeof d.answers === "object" ? d.answers : {};
  const answers = blankAnswers();
  for (const q of QUESTIONS) {
    answers[q.key] = q.single ? (typeof a[q.key] === "string" ? a[q.key] : null) : Array.isArray(a[q.key]) ? a[q.key].filter((x) => typeof x === "string") : [];
  }
  const custom = {};
  for (const q of QUESTIONS) custom[q.key] = Array.isArray(d.custom?.[q.key]) ? d.custom[q.key].filter((x) => typeof x === "string") : [];
  return {
    id: d.id,
    restaurant: String(d.restaurant || ""),
    neighborhood: String(d.neighborhood || ""),
    datetime: String(d.datetime || new Date().toISOString()),
    status: ["needs_review", "draft_ready", "done", "skipped"].includes(d.status) ? d.status : "needs_review",
    answers,
    custom,
    notes: String(d.notes || ""),
    dishes: Array.isArray(d.dishes) ? d.dishes.filter((x) => typeof x === "string") : [],
    draft: String(d.draft || ""),
    length: LENGTHS.includes(d.length) ? d.length : "base",
    draftHistory: Array.isArray(d.draftHistory) ? d.draftHistory.filter((h) => h && typeof h.draft === "string").slice(-10) : [],
    step: Number.isInteger(d.step) ? d.step : 0,
    doneAt: d.doneAt || null,
  };
}

// What the server last said about her calendar. `connected` is null until
// the first successful sync, so the home screen doesn't claim either way.
function cleanCalendar(c) {
  const ok = c && typeof c === "object";
  return {
    connected: ok && typeof c.connected === "boolean" ? c.connected : null,
    syncedAt: ok && typeof c.syncedAt === "string" ? c.syncedAt : null,
    upcoming: ok && Array.isArray(c.upcoming)
      ? c.upcoming.filter((u) => u && typeof u.restaurant === "string" && typeof u.datetime === "string")
      : [],
  };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY)) || {};
    return {
      settings: s.settings && typeof s.settings === "object" ? s.settings : {},
      dinners: Array.isArray(s.dinners) ? s.dinners.map(cleanDinner).filter(Boolean) : [],
      route: s.route && typeof s.route === "object" ? s.route : { name: "queue" },
      calendar: cleanCalendar(s.calendar),
    };
  } catch {
    return { settings: {}, dinners: [], route: { name: "queue" }, calendar: cleanCalendar() };
  }
}

const state = load();
// Things that never persist: in-flight work and transient UI.
const ui = { generating: false, draftError: "", copied: false, adding: false, micError: "", lastOp: null };

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: keep going in memory */ }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const dinner = (id) => state.dinners.find((d) => d.id === id);
const apiUrl = () => (state.settings.apiUrl || CONFIG.apiUrl || "").replace(/\/$/, "");

// ---------- helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ICONS = {
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const icon = (name, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const avatar = (size) => `<img class="avatar" src="./alec.svg" alt="Alec" width="${size}" height="${size}">`;
const alecRow = (size, caption) =>
  `<div class="alec">${avatar(size)}<div class="who"><span class="name">Alec</span><span class="caption">${esc(caption)}</span></div></div>`;

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
const shortDate = (d) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const time = (d) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

// "Tonight", "Today", "Yesterday", or "Tue, Oct 6".
function dayLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return d.getHours() >= 17 ? "Tonight" : "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  return shortDate(d);
}
function relativeLower(iso) {
  const l = dayLabel(iso);
  return /^(Tonight|Today|Yesterday)$/.test(l) ? l.toLowerCase() : `on ${l}`;
}
const words = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

// ---------- toast ----------
let toastTimer;
function toast(msg, undo) {
  const t = document.getElementById("toast");
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Undo</button>' : ""}`;
  t.hidden = false;
  if (undo) {
    t.querySelector("button").onclick = () => {
      t.hidden = true;
      undo();
    };
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), undo ? 5000 : 2200);
}

// ---------- routing ----------
function go(route) {
  if (listening) stopListening();
  state.route = route;
  ui.adding = false;
  ui.micError = "";
  if (route.name === "question") {
    const d = dinner(route.id);
    if (d) {
      d.step = route.step;
      // What the answer was on arrival, so Skip can leave without saving.
      ui.snapshot = JSON.stringify(d.answers[QUESTIONS[route.step].key]);
    }
  }
  save();
  render();
  window.scrollTo(0, 0);
}

// ---------- screens ----------
function ago(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60e3);
  if (!Number.isFinite(min)) return "";
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`;
}

// Most frequent strings across lists, most common first.
function mostCommon(lists, n) {
  const counts = new Map();
  for (const list of lists) for (const x of list) counts.set(x, (counts.get(x) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([x]) => x);
}

function screenQueue() {
  const by = (s) => state.dinners.filter((d) => d.status === s);
  const review = by("needs_review").sort((a, b) => b.datetime.localeCompare(a.datetime));
  const drafts = by("draft_ready").sort((a, b) => b.datetime.localeCompare(a.datetime));
  const done = by("done").sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
  const reviewed = [...drafts, ...done];
  const now = Date.now();
  const upcoming = state.calendar.upcoming
    .filter((u) => Date.parse(u.datetime) > now)
    .sort((a, b) => a.datetime.localeCompare(b.datetime))
    .slice(0, 3);

  const bits = [];
  if (review.length) bits.push(`${review.length} to review`);
  if (drafts.length) bits.push(`${drafts.length} ${drafts.length === 1 ? "draft" : "drafts"} ready to paste`);
  const summary = bits.length
    ? `${bits.join(", ")}.`
    : upcoming.length
      ? `Nothing to review yet. Next up: ${upcoming[0].restaurant}, ${dayLabel(upcoming[0].datetime).replace(/^(Today|Tonight)$/, (m) => m.toLowerCase())}.`
      : reviewed.length
        ? "All caught up."
        : "Alec will ask about each meal after you eat.";

  // Only one solid brand button per screen. The newest dinner to review gets
  // it; otherwise the quick-start card does.
  const reviewCards = review
    .map(
      (d, i) => `
      <div class="card">
        <div class="info">
          <span class="badge badge-review">Needs review</span>
          <div class="stack-2">
            <h2 class="title">${esc(d.restaurant)}</h2>
            <p class="caption">${esc([dayLabel(d.datetime), time(new Date(d.datetime)), d.neighborhood].filter(Boolean).join(" · "))}</p>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn btn-grow ${i === 0 ? "btn-primary" : "btn-secondary"}" data-act="review" data-id="${d.id}">${d.step > 0 ? "Keep going" : "Review now"}</button>
          <button class="btn btn-secondary btn-auto" data-act="skip-dinner" data-id="${d.id}">Didn't go</button>
        </div>
      </div>`,
    )
    .join("");

  const draftCards = drafts
    .map(
      (d) => `
      <div class="card">
        <button class="info" data-act="open-draft" data-id="${d.id}">
          <span class="badge badge-draft">Draft ready</span>
          <span class="stack-2">
            <span class="title">${esc(d.restaurant)}</span>
            <span class="caption">${esc(`${dayLabel(d.datetime)} · ${time(new Date(d.datetime))}`)}</span>
          </span>
          <span class="body clamp">“${esc(d.draft)}”</span>
        </button>
        <button class="btn btn-outline" data-act="copy-queue" data-id="${d.id}">${icon("copy")}${CONFIG.beliUrl ? "Copy and open Beli" : "Copy for Beli"}</button>
      </div>`,
    )
    .join("");

  const quick = `
    <form class="card" id="quick-form">
      <div class="stack-2">
        <h2 class="title">Just ate somewhere?</h2>
        <p class="caption">Tell Alec while it's fresh.</p>
      </div>
      <div class="quick-row">
        <input class="field-box on-card" name="restaurant" placeholder="Restaurant name" autocomplete="off" autocapitalize="words" enterkeyhint="go" aria-label="Restaurant name">
        <button class="btn btn-auto ${review.length ? "btn-ink" : "btn-primary"}" type="submit">Start</button>
      </div>
    </form>`;

  const comingUp = upcoming.length
    ? `
    <section class="stack-12">
      <p class="label">Coming up</p>
      <div class="list">
        ${upcoming
          .map((u) => {
            const d = new Date(u.datetime);
            return `
          <div class="list-row">
            <div class="date-tile"><span>${esc(d.toLocaleDateString(undefined, { month: "short" }))}</span><b>${d.getDate()}</b></div>
            <div class="stack-2">
              <span class="nm">${esc(u.restaurant)}</span>
              <span class="caption">${esc(`${d.toLocaleDateString(undefined, { weekday: "short" })} · ${time(d)} · Alec will ask after`)}</span>
            </div>
          </div>`;
          })
          .join("")}
      </div>
    </section>`
    : "";

  let taste;
  if (reviewed.length) {
    const loved = reviewed.filter((d) => d.answers.overall === "Loved it");
    const again = reviewed.filter((d) => d.answers.goBack === "Definitely");
    const vibes = mostCommon(reviewed.map((d) => d.answers.vibe), 6);
    const dishes = mostCommon((loved.length ? loved : reviewed).map((d) => d.dishes), 6);
    const pills = (xs) => `<div class="pills">${xs.map((x) => `<span class="pill-static">${esc(x)}</span>`).join("")}</div>`;
    taste = `
    <section class="stack-12">
      <p class="label">Your taste</p>
      <div class="stats">
        <div class="stat"><b>${reviewed.length}</b><span class="caption">Reviewed</span></div>
        <div class="stat"><b>${loved.length}</b><span class="caption">Loved</span></div>
        <div class="stat"><b>${again.length}</b><span class="caption">Going back</span></div>
      </div>
      ${vibes.length ? `<div class="stack-8"><p class="caption">Vibes you go for</p>${pills(vibes)}</div>` : ""}
      ${dishes.length ? `<div class="stack-8"><p class="caption">Dishes you loved</p>${pills(dishes)}</div>` : ""}
    </section>`;
  } else {
    taste = `
    <section class="card how">
      <h2 class="title">How it works</h2>
      <ol class="steps">
        <li><span class="num">1</span><span>Book on Resy or OpenTable, or put "Dinner at …" on your calendar.</span></li>
        <li><span class="num">2</span><span>About 30 minutes after, Alec asks how it was. A few taps, plus a voice note if you like.</span></li>
        <li><span class="num">3</span><span>He writes the review in your voice. Copy it into Beli.</span></li>
      </ol>
    </section>`;
  }

  const doneRows = done
    .slice(0, 5)
    .map(
      (d) => `
      <div class="done-row">
        <div class="tick">${icon("check")}</div>
        <div class="stack-2">
          <span class="nm">${esc(d.restaurant)}</span>
          <span class="caption">Posted to Beli · ${esc(shortDate(new Date(d.doneAt || d.datetime)))}</span>
        </div>
      </div>`,
    )
    .join("");

  const cal = state.calendar;
  const status = demo || (cal.connected && cal.syncedAt)
    ? `${icon("check", "i-16")}Calendar connected · checked ${ago(demo ? new Date().toISOString() : cal.syncedAt)}`
    : cal.connected === false
      ? "No calendar connected yet."
      : !connected()
        ? "Tap Alec to connect the server."
        : "";

  return `
    <div class="screen">
      <div class="content home">
        <div class="stack-8">
          <div class="home-head">
            <h1 class="display">Your dinners</h1>
            <button class="avatar-btn" data-act="settings" aria-label="Settings">${avatar(48)}</button>
          </div>
          <p class="body muted">${esc(summary)}</p>
        </div>
        ${review.length || drafts.length ? `<div class="cards">${reviewCards}${draftCards}</div>` : ""}
        ${quick}
        ${comingUp}
        ${taste}
        ${doneRows ? `<section class="stack-12"><p class="label">Recently posted</p><div>${doneRows}</div></section>` : ""}
        ${status ? `<p class="cal-status">${status}</p>` : ""}
      </div>
      <div class="actions">
        <button class="btn btn-secondary" data-act="add">${icon("plus")}Add a meal</button>
      </div>
    </div>`;
}

function screenQuestion(d, step) {
  const q = QUESTIONS[step];
  const value = d.answers[q.key];
  const isOn = (opt) => (q.single ? value === opt : value.includes(opt));
  const options = [...q.options, ...(d.custom[q.key] || [])];

  const dots = QUESTIONS.map((_, i) => `<span class="${i < step ? "done" : i === step ? "now" : ""}"></span>`).join("");
  const chips = options
    .map((opt) => {
      const on = isOn(opt);
      const tone = q.key === "overall" ? VERDICT_CLASS[opt] || "" : "";
      return `<button class="chip ${on ? "on" : ""} ${tone}" aria-pressed="${on}" data-act="pick" data-opt="${esc(opt)}"><span>${esc(opt)}</span>${on ? icon("check", "i-20 check") : ""}</button>`;
    })
    .join("");
  const own = q.single
    ? ""
    : ui.adding
      ? `<input class="chip-input" id="own-input" type="text" placeholder="Your own" maxlength="40" enterkeyhint="done" autocomplete="off">`
      : `<button class="chip add" data-act="own">${icon("plus", "i-20")}Your own</button>`;

  return `
    <div class="screen">
      <div class="topbar">
        <button class="icon-btn" data-act="q-back" aria-label="Back">${icon("back")}</button>
        <div class="dots" aria-label="Step ${step + 1} of ${QUESTIONS.length}">${dots}</div>
        <button class="skip" data-act="q-skip">Skip</button>
      </div>
      <div class="content">
        <div class="stack-8">
          ${alecRow(64, `Asking about ${d.restaurant}, ${relativeLower(d.datetime)}`)}
          <h1 class="display">${esc(q.title)}</h1>
          <p class="body muted">${q.single ? "Pick one." : "Pick as many as you like."}</p>
        </div>
        <div class="chips">${chips}${own}</div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" data-act="q-next">Next</button>
      </div>
    </div>`;
}

function screenNotes(d) {
  const dishChips = d.dishes
    .map((x) => `<button class="chip on" data-act="remove-dish" data-opt="${esc(x)}" aria-label="Remove ${esc(x)}"><span>${esc(x)}</span>${icon("check", "i-20 check")}</button>`)
    .join("");
  const add = ui.adding
    ? `<input class="chip-input" id="dish-input" type="text" placeholder="Dish name" maxlength="50" enterkeyhint="done" autocomplete="off">`
    : `<button class="chip add" data-act="add-dish">${icon("plus", "i-20")}Add dish</button>`;

  return `
    <div class="screen">
      <div class="topbar">
        <button class="icon-btn" data-act="notes-back" aria-label="Back">${icon("back")}</button>
        <p class="caption center">Last step</p>
        <span></span>
      </div>
      <div class="content tight">
        <div class="stack-12">
          ${alecRow(64, "Last one, promise")}
          <h1 class="display">Anything to remember?</h1>
        </div>
        <textarea class="field-box" id="notes" placeholder="Best dish? Anything you'd skip?">${esc(d.notes)}</textarea>
        <div class="stack-12">
          <p class="label">Favorite dishes</p>
          <div class="chips tight">${dishChips}${add}</div>
        </div>
        <div class="mic-area">
          <button class="mic ${listening ? "live" : ""}" id="mic" data-act="mic" aria-label="${listening ? "Stop listening" : "Tap to talk"}">${icon("mic")}</button>
          <p class="mic-label" id="mic-label">${listening ? "Listening… tap to stop" : "Tap to talk"}</p>
          ${ui.micError ? `<p class="caption">${esc(ui.micError)}</p>` : ""}
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-ink" data-act="write" ${ui.generating ? "disabled" : ""}>${ui.generating ? "Writing…" : "Write my review"}</button>
      </div>
    </div>`;
}

function screenDraft(d) {
  const overall = d.answers.overall;
  const badge = overall
    ? `<span class="badge badge-verdict ${VERDICT_CLASS[overall] || ""}">${icon("check", "i-16 check")}${esc(overall)}</span>`
    : "";

  let card;
  if (ui.generating) card = `<div class="draft-card writing">Writing…</div>`;
  else if (ui.draftError) {
    card = `<div class="draft-card draft-error"><p>${esc(ui.draftError)}</p><button class="btn btn-secondary btn-auto" data-act="retry">Try again</button></div>`;
  } else card = `<div class="draft-card">${esc(d.draft)}</div>`;

  const busy = ui.generating || !d.draft;
  const copyLabel = ui.copied
    ? `${icon("check")}${CONFIG.beliUrl ? "Copied. Opening Beli" : "Copied. Now open Beli"}`
    : `${icon("copy")}${CONFIG.beliUrl ? "Copy and open Beli" : "Copy for Beli"}${CONFIG.beliUrl ? icon("external", "i-20") : ""}`;

  return `
    <div class="screen">
      <div class="topbar" style="display:flex;justify-content:space-between">
        <button class="icon-btn" data-act="draft-back" aria-label="Back">${icon("back")}</button>
        <button class="icon-btn" data-act="home" aria-label="Close">${icon("close")}</button>
      </div>
      <div class="content tight">
        <div class="stack-12">
          ${badge}
          <div class="stack-8">
            ${alecRow(48, "Wrote this in your voice")}
            <h1 class="display">Here's your draft</h1>
            <p class="caption">${esc(d.restaurant)}${d.draft && !ui.generating ? ` · ${words(d.draft)} words, in your voice` : ""}</p>
          </div>
        </div>
        ${card}
        <div class="pill-row">
          <button class="pill" data-act="len" data-dir="-1" ${busy || d.length === "short" ? "disabled" : ""}>Shorter</button>
          <button class="pill" data-act="len" data-dir="1" ${busy || d.length === "long" ? "disabled" : ""}>Longer</button>
          <button class="pill" data-act="redo" ${busy ? "disabled" : ""}>Redo</button>
        </div>
      </div>
      <div class="actions gap-4">
        <button class="btn btn-primary" data-act="copy-draft" ${busy ? "disabled" : ""}>${copyLabel}</button>
        <button class="btn btn-text" data-act="home">Save for later</button>
      </div>
    </div>`;
}

function screenAdd() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return `
    <div class="screen">
      <div class="topbar">
        <span></span><span></span>
        <button class="icon-btn" data-act="home" aria-label="Close">${icon("close")}</button>
      </div>
      <form class="content tight" id="add-form">
        <div class="stack-12">
          ${alecRow(64, "Where'd you go?")}
          <h1 class="display">Add a meal</h1>
        </div>
        <div class="form">
          <label><span class="label">Restaurant</span><input class="field-box" name="restaurant" required autocomplete="off" autocapitalize="words" enterkeyhint="next"></label>
          <label><span class="label">Neighborhood (optional)</span><input class="field-box" name="neighborhood" autocomplete="off" autocapitalize="words"></label>
          <label><span class="label">When</span><input class="field-box" name="when" type="datetime-local" value="${now.toISOString().slice(0, 16)}"></label>
        </div>
      </form>
      <div class="actions">
        <button class="btn btn-primary" type="submit" form="add-form">Start review</button>
      </div>
    </div>`;
}

function screenSettings() {
  const s = state.settings;
  return `
    <div class="screen">
      <div class="topbar">
        <button class="icon-btn" data-act="home" aria-label="Back">${icon("back")}</button>
        <p class="caption center">Settings</p>
        <span></span>
      </div>
      <form class="content tight" id="settings-form">
        <div class="stack-12">
          ${alecRow(64, "Only needed once")}
          <h1 class="display">Settings</h1>
        </div>
        <div class="form">
          <label><span class="label">Passcode</span><input class="field-box" name="passcode" type="password" autocomplete="off" value="${esc(s.passcode || "")}"></label>
          <label><span class="label">A few of your past Beli reviews (optional)</span><textarea class="field-box" name="samples" placeholder="Paste two or three and drafts will sound like these.">${esc(s.samples || "")}</textarea></label>
          <label><span class="label">Server</span><input class="field-box" name="apiUrl" type="url" autocomplete="off" placeholder="https://dinner-notes.example.workers.dev" value="${esc(s.apiUrl || CONFIG.apiUrl || "")}"></label>
        </div>
        <div class="stack-8">
          <p class="label">Reminders after dinner</p>
          ${pushRow()}
        </div>
      </form>
      <div class="actions">
        <button class="btn btn-primary" type="submit" form="settings-form">Save</button>
      </div>
    </div>`;
}

function render() {
  const r = state.route;
  const d = r.id ? dinner(r.id) : null;
  let html;
  if (r.name === "question" && d && QUESTIONS[r.step]) html = screenQuestion(d, r.step);
  else if (r.name === "notes" && d) html = screenNotes(d);
  else if (r.name === "draft" && d) html = screenDraft(d);
  else if (r.name === "add") html = screenAdd();
  else if (r.name === "settings") html = screenSettings();
  else {
    state.route = { name: "queue" };
    html = screenQueue();
  }
  document.getElementById("app").innerHTML = html;

  const own = document.getElementById("own-input") || document.getElementById("dish-input");
  if (own) {
    own.focus();
    own.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        own.blur();
      } else if (e.key === "Escape") {
        own.value = "";
        own.blur();
      }
    });
    own.addEventListener("blur", () => commitAdd(own.value.trim()), { once: true });
  }
  const notes = document.getElementById("notes");
  if (notes) notes.addEventListener("input", () => {
    d.notes = notes.value;
    save();
  });
}

function commitAdd(text) {
  const r = state.route;
  const d = dinner(r.id);
  ui.adding = false;
  if (d && text) {
    if (r.name === "question") {
      const q = QUESTIONS[r.step];
      if (!d.custom[q.key].includes(text) && !q.options.includes(text)) d.custom[q.key].push(text);
      if (!d.answers[q.key].includes(text)) d.answers[q.key].push(text);
    } else if (r.name === "notes" && !d.dishes.includes(text)) {
      d.dishes.push(text);
    }
    save();
  }
  render();
}

// ---------- voice ----------
// Web Speech API where available (Safari and Chrome on iPhone). iOS ends a
// session after a pause, so it restarts until she taps stop.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let listening = false;
let committed = "";
let sessionFinal = "";

const joinText = (a, b) => (!a ? b : !b ? a : /\s$/.test(a) ? a + b : `${a} ${b}`);

function setMicUi() {
  const mic = document.getElementById("mic");
  const label = document.getElementById("mic-label");
  if (!mic) return;
  mic.classList.toggle("live", listening);
  mic.setAttribute("aria-label", listening ? "Stop listening" : "Tap to talk");
  label.textContent = listening ? "Listening… tap to stop" : "Tap to talk";
}

function writeNotes(text) {
  const d = dinner(state.route.id);
  const el = document.getElementById("notes");
  if (!d) return;
  d.notes = text;
  if (el) el.value = text;
  save();
}

function startListening() {
  const d = dinner(state.route.id);
  committed = (d?.notes || "").trim();
  sessionFinal = "";
  rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = navigator.language || "en-US";
  rec.onresult = (e) => {
    let finals = "";
    let interim = "";
    for (let i = 0; i < e.results.length; i++) {
      if (e.results[i].isFinal) finals += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    sessionFinal = finals.trim();
    writeNotes(joinText(committed, joinText(sessionFinal, interim.trim())));
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      listening = false;
      ui.micError = "Mic is off. You can still type.";
      render();
    }
  };
  rec.onend = () => {
    committed = joinText(committed, sessionFinal);
    sessionFinal = "";
    writeNotes(committed);
    if (listening) {
      try { rec.start(); } catch { listening = false; setMicUi(); }
    }
  };
  try {
    rec.start();
    listening = true;
  } catch {
    listening = false;
  }
  setMicUi();
}

function stopListening() {
  listening = false;
  rec?.stop();
  setMicUi();
}

// ---------- drafting ----------
const DEMO_DRAFTS = {
  short: "Lilia lived up to the hype. The mafaldine was the best pasta I've had all year. Cozy, a little romantic, pricey but worth it. Going back.",
  base: "Lilia lived up to the hype. The mafaldine with pink peppercorn was the best pasta I've had all year, and the grilled clams were so good we almost ordered seconds. Cozy and a little romantic without feeling stuffy, and our server was genuinely warm. Pricey but worth it. Already planning the next visit.",
  long: "Lilia lived up to the hype. The mafaldine with pink peppercorn was the best pasta I've had all year, and the grilled clams were so good we almost ordered seconds. Cozy and a little romantic without feeling stuffy. We sat near the open kitchen, which made it feel like a dinner party. Our server was genuinely warm and paced everything perfectly. Pricey but worth it for a date night. Ask for the corner table if you can. Already planning the next visit.",
  redo: "Okay, Lilia is officially a favorite. That mafaldine? Unreal. The clams were a close second. It's cozy and low-lit in the best way, perfect for a date, and the service felt warm, never rushed. Not cheap, but I'd happily pay it again. Definitely going back.",
};

async function requestDraft(d, { length, mode, previous }) {
  if (demo) {
    await new Promise((r) => setTimeout(r, 1200));
    return mode === "redo" && previous !== DEMO_DRAFTS.redo ? DEMO_DRAFTS.redo : DEMO_DRAFTS[length];
  }
  const url = apiUrl();
  if (!url || !state.settings.passcode) throw new Error("Not connected yet. Tap Alec on the home screen to add the server and passcode.");
  let res;
  try {
    res = await fetch(`${url}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-passcode": state.settings.passcode },
      body: JSON.stringify({
        restaurant: d.restaurant,
        neighborhood: d.neighborhood,
        date: new Date(d.datetime).toDateString(),
        answers: d.answers,
        notes: d.notes,
        dishes: d.dishes,
        samples: state.settings.samples || "",
        length,
        mode,
        previous,
      }),
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection.");
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("Wrong passcode. Tap Alec on the home screen to fix it.");
  if (!res.ok || !body.draft) throw new Error(body.error || "Couldn't write the draft.");
  return body.draft;
}

// op: { length, mode: "first" | "resize" | "redo" }
async function draft(d, op) {
  ui.lastOp = op;
  ui.generating = true;
  ui.draftError = "";
  ui.copied = false;
  render();
  try {
    const previous = op.mode === "first" ? "" : d.draft;
    const text = await requestDraft(d, { length: op.length, mode: op.mode, previous });
    if (d.draft) d.draftHistory.push({ draft: d.draft, length: d.length });
    d.draftHistory = d.draftHistory.slice(-10);
    d.draft = text;
    d.length = op.length;
    if (d.status === "needs_review") d.status = "draft_ready";
    save();
    return true;
  } catch (err) {
    ui.draftError = err.message;
    return false;
  } finally {
    ui.generating = false;
  }
}

function undoDraft(d) {
  const prev = d.draftHistory.pop();
  if (!prev) return;
  d.draft = prev.draft;
  d.length = prev.length;
  save();
  render();
}

// Copy, then hand off to Beli. clipboard.writeText is called synchronously
// inside the tap so iOS treats it as user-initiated.
function copyForBeli(d) {
  let ok = true;
  try {
    navigator.clipboard.writeText(d.draft).catch(() => {});
  } catch {
    ok = false;
  }
  if (!ok) {
    toast("Couldn't copy. Long-press the draft instead.");
    return false;
  }
  d.status = "done";
  d.doneAt = new Date().toISOString();
  save();
  if (CONFIG.beliUrl) setTimeout(() => (location.href = CONFIG.beliUrl), 600);
  return true;
}

// ---------- actions ----------
const actions = {
  home: () => go({ name: "queue" }),
  "push-on": () => enablePush(),
  settings: () => go({ name: "settings" }),
  add: () => go({ name: "add" }),

  review: (el) => {
    const d = dinner(el.dataset.id);
    go({ name: "question", id: d.id, step: Math.min(d.step || 0, QUESTIONS.length - 1) });
  },
  "skip-dinner": (el) => {
    const d = dinner(el.dataset.id);
    const prev = d.status;
    d.status = "skipped";
    save();
    render();
    toast(`Removed ${d.restaurant}`, () => {
      d.status = prev;
      save();
      render();
    });
  },
  "open-draft": (el) => {
    ui.draftError = "";
    ui.copied = false;
    go({ name: "draft", id: el.dataset.id });
  },
  "copy-queue": (el) => {
    const d = dinner(el.dataset.id);
    if (copyForBeli(d)) {
      render();
      toast(CONFIG.beliUrl ? "Copied. Opening Beli" : "Copied. Paste it into Beli");
    }
  },

  pick: (el) => {
    const d = dinner(state.route.id);
    const q = QUESTIONS[state.route.step];
    const opt = el.dataset.opt;
    if (q.single) d.answers[q.key] = d.answers[q.key] === opt ? null : opt;
    else {
      const list = d.answers[q.key];
      d.answers[q.key] = list.includes(opt) ? list.filter((x) => x !== opt) : [...list, opt];
    }
    save();
    render();
  },
  own: () => {
    ui.adding = true;
    render();
  },
  "q-back": () => {
    const { id, step } = state.route;
    step > 0 ? go({ name: "question", id, step: step - 1 }) : go({ name: "queue" });
  },
  "q-skip": () => {
    const d = dinner(state.route.id);
    d.answers[QUESTIONS[state.route.step].key] = JSON.parse(ui.snapshot);
    actions["q-next"]();
  },
  "q-next": () => {
    const { id, step } = state.route;
    step < QUESTIONS.length - 1 ? go({ name: "question", id, step: step + 1 }) : go({ name: "notes", id });
  },

  "add-dish": () => {
    ui.adding = true;
    render();
  },
  "remove-dish": (el) => {
    const d = dinner(state.route.id);
    const dish = el.dataset.opt;
    const at = d.dishes.indexOf(dish);
    d.dishes = d.dishes.filter((x) => x !== dish);
    save();
    render();
    toast(`Removed ${dish}`, () => {
      d.dishes.splice(at, 0, dish);
      save();
      render();
    });
  },
  mic: () => {
    if (!SR) {
      ui.micError = "Use the mic on your keyboard instead.";
      render();
      document.getElementById("notes")?.focus();
      return;
    }
    ui.micError = "";
    listening ? stopListening() : startListening();
  },
  "notes-back": () => go({ name: "question", id: state.route.id, step: QUESTIONS.length - 1 }),
  write: async () => {
    const d = dinner(state.route.id);
    if (listening) stopListening();
    await draft(d, { length: "base", mode: "first" });
    go({ name: "draft", id: d.id });
  },

  "draft-back": () => go({ name: "notes", id: state.route.id }),
  len: async (el) => {
    const d = dinner(state.route.id);
    const i = LENGTHS.indexOf(d.length) + Number(el.dataset.dir);
    const length = LENGTHS[Math.max(0, Math.min(LENGTHS.length - 1, i))];
    if (await draft(d, { length, mode: "resize" })) toast(Number(el.dataset.dir) < 0 ? "Shorter draft" : "Longer draft", () => undoDraft(d));
    render();
  },
  redo: async () => {
    const d = dinner(state.route.id);
    if (await draft(d, { length: d.length, mode: "redo" })) toast("New draft", () => undoDraft(d));
    render();
  },
  retry: async () => {
    const d = dinner(state.route.id);
    const op = ui.lastOp || { length: d.length, mode: d.draft ? "redo" : "first" };
    await draft(d, op);
    render();
  },
  "copy-draft": () => {
    const d = dinner(state.route.id);
    if (!copyForBeli(d)) return;
    ui.copied = true;
    render();
    setTimeout(() => {
      ui.copied = false;
      if (state.route.name === "draft") go({ name: "queue" });
    }, 1400);
  },
};

document.getElementById("app").addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el);
});

document.getElementById("app").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  if (e.target.id === "quick-form") {
    const restaurant = String(f.get("restaurant") || "").trim();
    if (!restaurant) return e.target.querySelector("input").focus();
    const d = cleanDinner({ id: uid(), restaurant, datetime: new Date().toISOString(), status: "needs_review" });
    state.dinners.push(d);
    go({ name: "question", id: d.id, step: 0 });
  } else if (e.target.id === "add-form") {
    const restaurant = String(f.get("restaurant") || "").trim();
    if (!restaurant) return;
    const when = f.get("when") ? new Date(f.get("when")) : new Date();
    const d = cleanDinner({
      id: uid(),
      restaurant,
      neighborhood: String(f.get("neighborhood") || "").trim(),
      datetime: (isNaN(when) ? new Date() : when).toISOString(),
      status: "needs_review",
    });
    state.dinners.push(d);
    go({ name: "question", id: d.id, step: 0 });
  } else if (e.target.id === "settings-form") {
    state.settings = {
      passcode: String(f.get("passcode") || "").trim(),
      samples: String(f.get("samples") || "").trim(),
      apiUrl: String(f.get("apiUrl") || "").trim(),
      pushOn: Boolean(state.settings.pushOn),
    };
    go({ name: "queue" });
    syncDinners();
    toast("Saved");
  }
});

// ---------- calendar sync ----------
// The server reads her calendar; the app pulls the reservations it found and
// adds any it hasn't seen. Ones she already handled (or said she skipped)
// stay as they are, because they are matched by id.

const connected = () => !demo && apiUrl() && state.settings.passcode;
let vapidPublicKey = "";

async function syncDinners() {
  if (!connected()) return;
  try {
    const res = await fetch(`${apiUrl()}/dinners`, { headers: { "x-passcode": state.settings.passcode } });
    if (!res.ok) return;
    const body = await res.json();
    vapidPublicKey = body.vapidPublicKey || "";
    const before = JSON.stringify(state.calendar);
    state.calendar = cleanCalendar({ connected: Boolean(body.calendar), syncedAt: body.syncedAt, upcoming: body.upcoming });
    const calendarChanged = JSON.stringify(state.calendar) !== before;
    let added = 0;
    for (const found of Array.isArray(body.dinners) ? body.dinners : []) {
      if (dinner(found.id)) continue;
      const d = cleanDinner({ ...found, status: "needs_review" });
      if (d) {
        state.dinners.push(d);
        added++;
      }
    }
    if (added || calendarChanged) save();
    if ((added || calendarChanged) && (state.route.name === "queue" || state.route.name === "settings")) render();
  } catch {
    // Offline: the queue still works with what's saved.
  }
}

// ---------- push ----------
// iOS only offers push to apps added to the Home Screen, so the row explains
// that instead of showing a button that can't work.

const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function pushRow() {
  if (!pushSupported()) {
    return `<p class="body muted">Add Dinner Notes to your Home Screen (Share, then Add to Home Screen) and open it from there to get a nudge after each reservation.</p>`;
  }
  if (Notification.permission === "denied") return `<p class="body muted">Notifications are off for this app in Settings.</p>`;
  if (state.settings.pushOn && Notification.permission === "granted") {
    return `<p class="body muted">On. Alec will ask about each reservation on your calendar about 30 minutes after it ends.</p>`;
  }
  if (!connected()) return `<p class="body muted">Save the passcode and server first.</p>`;
  return `<button type="button" class="btn btn-secondary" data-act="push-on">Turn on reminders</button>`;
}

function keyBytes(b64) {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function enablePush() {
  if (!vapidPublicKey) await syncDinners();
  if (!vapidPublicKey) return toast("The server isn't set up for reminders yet.");
  if ((await Notification.requestPermission()) !== "granted") return render();
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey) }));
    const res = await fetch(`${apiUrl()}/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-passcode": state.settings.passcode },
      body: JSON.stringify(sub),
    });
    if (!res.ok) throw new Error();
    state.settings.pushOn = true;
    save();
    render();
    toast("Reminders on");
  } catch {
    toast("Couldn't turn on reminders. Try again.");
  }
}

if ("serviceWorker" in navigator && !demo) navigator.serviceWorker.register("./sw.js").catch(() => {});

// A notification opens ./?dinner=<id>: jump straight to that dinner's questions.
async function openFromLink() {
  const id = new URLSearchParams(location.search).get("dinner");
  if (!id) return;
  history.replaceState(null, "", location.pathname + (demo ? "?demo" : ""));
  if (!dinner(id)) await syncDinners();
  const d = dinner(id);
  if (d && d.status === "needs_review") go({ name: "question", id, step: Math.min(d.step || 0, QUESTIONS.length - 1) });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") syncDinners();
});

// ---------- demo seed ----------
// ?demo fills an empty app with the three dinners from the design and fakes
// the server, so the whole flow can be tried without setup.
if (demo && !state.dinners.length) {
  const at = (daysAgo, h, m) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  state.dinners = [
    { id: "lilia", restaurant: "Lilia", neighborhood: "Williamsburg", datetime: at(0, 19, 30), status: "needs_review", notes: "Pasta was unreal. Corner table by the kitchen next time. Skip the dessert.", dishes: ["Mafaldine", "Grilled clams"] },
    { id: "via-carota", restaurant: "Via Carota", datetime: at(3, 20, 0), status: "draft_ready", answers: { overall: "Loved it", vibe: ["Cozy", "Lively"], goBack: "Definitely" }, dishes: ["Cacio e pepe", "Insalata verde"], draft: "Worth every minute of the wait. The cacio e pepe was silky and the bar seats felt like a little secret. Cozy, buzzy and somehow still relaxed. Get the insalata verde even if it sounds boring." },
    { id: "don-angie", restaurant: "Don Angie", datetime: at(6, 19, 0), status: "done", doneAt: at(6, 22, 15), answers: { overall: "Loved it", vibe: ["Lively", "Romantic"], goBack: "Definitely" }, dishes: ["Pinwheel lasagna"] },
    { id: "misi", restaurant: "Misi", datetime: at(12, 20, 30), status: "done", doneAt: at(12, 23, 0), answers: { overall: "It was fine", vibe: ["Cozy"], goBack: "Maybe" }, dishes: ["Sweet pepper agnolotti"] },
  ].map(cleanDinner);
  const soon = new Date();
  soon.setDate(soon.getDate() + 2);
  soon.setHours(20, 0, 0, 0);
  state.calendar = cleanCalendar({ connected: true, syncedAt: new Date().toISOString(), upcoming: [{ id: "cal-demo-rezdora", restaurant: "Rezdôra", datetime: soon.toISOString() }] });
  save();
}

render();
openFromLink().then(syncDinners);
