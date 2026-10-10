# Aftertaste

A few taps after dinner, a review in her voice to paste into Beli.

Alec (the cartoon) asks one question per screen: overall, vibe, food, service,
value, occasion, would you go back. Then she adds notes by voice or typing, plus
favorite dishes, and gets a draft written in her voice. Shorter / Longer / Redo
reshape it; one tap copies it for Beli.

`design/` holds the design handoff, which is the source of truth for the UI:
tokens, components, copy and behavior. Read `design/README.md` before changing
how anything looks. Two of its rules are easy to break: no shadows or gradients,
and at most one solid teal element per screen.

## Layout

- `web/`: the phone app. Plain HTML/CSS/JS, no build. Static on GitHub Pages.
- `worker/`: a Cloudflare Worker that holds the Anthropic API key and calls
  Claude. The web app never sees the key.
- `design/`: the handoff (open `Dinner Notes.dc.html` to see the four mocks).

## Try it without setup

```
npx serve web
```

Then open `/?demo`. Demo mode seeds the three dinners from the design and
fakes the server, so the whole flow works offline.

## Deploy

**1. Server**: needs a free Cloudflare account and an Anthropic API key.

```
cd worker && npm install && npm run setup
```

`setup` logs in to Cloudflare, creates the storage and notification keys,
deploys, asks for the four values only a person should type (an email for push
services, the calendar link, the API key, her passcode), then points
`web/config.js` at the server and pushes. Re-running it skips finished steps.
The manual equivalent is in `worker/wrangler.toml`.

**2. Web app**: push this repo to GitHub and set Settings → Pages → Source to
"GitHub Actions". Every push to `main` that touches `web/` redeploys.

**3. Her phone**: open the site in Safari → Share → Add to Home Screen, and
open it from the Home Screen (iOS only allows notifications there). Tap Alec on
the home screen to open Settings, enter the passcode, tap "Turn on reminders",
and optionally paste a few of her past Beli reviews so drafts match her voice.

## Opening Beli

Beli publishes no universal links (its `apple-app-site-association` lists no
apps), so "Copy and open Beli" only copies until a working link is known. Try
`beli://` on her phone; if it opens the app, set `beliUrl` in `web/config.js`
and the button switches to "Copy and open Beli" and hands off after copying.

## Calendar and reminders

Every 15 minutes the Worker reads the published calendar (`src/calendar.js`)
and keeps reservations from the last 7 days: events mentioning Resy, OpenTable,
Tock or SevenRooms, or with "dinner" or "reservation" in the title. The
restaurant comes from the title ("Reservation at Lilia", "Dinner @ Misi w/ Sam",
"Carbone (Resy)") or, failing that, the event's location. Events with no
nameable restaurant, all-day events and cancelled ones are skipped. Recurring
events are not expanded.

About 30 minutes after a reservation ends, every subscribed phone gets "How
was Lilia?" (`src/push.js`, Web Push with no dependencies). Tapping it opens
that dinner's first question. The app also pulls new dinners into the queue
whenever it's opened, so reminders are a nudge, not the only way in.

The calendar link is a secret: anyone with it can read every event, so it
lives only in the Worker (`CALENDAR_URL`), never in this public repo. Turning
off "Public Calendar" in the Calendar app revokes it.

`npm test` in `worker/` covers calendar parsing and push encryption.

## Cost

One Claude Opus 5.5 call per draft, plus one per Shorter / Longer / Redo:
roughly a cent or two each. Cloudflare Workers' free tier covers the rest.
