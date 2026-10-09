# Handoff: Dinner Notes

## Overview
Dinner Notes is a personal mobile web app. After a dinner reservation on the user's calendar ends, it sends a push notification. The user answers one tap-to-select question per screen, adds notes by voice or typing, and gets an AI-written review in her own voice to paste into Beli (a restaurant ranking app). A cartoon character ("Alec") asks the questions.

## About the Design Files
The files in this bundle are **design references built in HTML**. They are prototypes that show the intended look and behavior, not production code to copy. Recreate them in the target codebase's environment using its own patterns. If there is no codebase yet, a good fit is a mobile-first PWA (React + Vite or Next.js) with Web Push, the Web Speech API (or a server speech-to-text API), and a server route that calls an LLM.

Open `Dinner Notes.dc.html` in a browser (keep `support.js` and `alec.svg` beside it) to see all four screens side by side. The vibe chips, mic, Shorter/Longer/Redo and Copy buttons work.

## Fidelity
**High-fidelity.** The colors, type, spacing, radii and copy are final. Match them exactly.

## Global rules
- Viewport is an iPhone at 390 × 844. Design mobile-first, one-handed, with high contrast.
- Show one question per screen.
- No shadows, no gradients, no emoji.
- Use **at most one solid brand (#0B7D71) element per screen**, usually the primary button. If something else on a screen is solid teal (the mic on Notes), the main action uses solid ink (#14201D) instead.
- Every tap target is at least 44px. Chips are 48px tall. Primary buttons are 52px tall, full-width pills.
- Screen side margins are 16px; there are 24px between sections.
- Status bar is 47px. The home-indicator area is 26px (a 134×5 ink pill). Use `env(safe-area-inset-*)` in production.
- Top bar is 52px tall with 8px side padding. It has 44×44 icon buttons (back on the left; close or Skip on the right).
- The bottom action area has 16px padding on the top and sides.

## Design Tokens
### Colors
| token | hex | use |
|---|---|---|
| surface | #FFFFFF | screen background |
| surface-2 | #F3F6F5 | unselected chips, queue cards, notes box, draft card |
| line | #E0E6E4 | hairline dividers, outlined secondary buttons (2px) |
| ink | #14201D | primary text, ink buttons |
| ink-muted | #56645F | dates, helper text, captions, completed progress dot |
| brand | #0B7D71 | primary button, selected chip border, active progress dot, mic |
| brand-tint | #DDF2EE | selected chip fill, "Draft ready" / "Loved it" badges, avatar background |
| on-brand | #FFFFFF | text and icons on brand |
| verdict-fine | #8F5C0E | "It was fine" verdict and "Needs review" badge text only |
| verdict-no | #B0352E | "Didn't like it" verdict only |

### Type (Plus Jakarta Sans from Google Fonts, fallback system-ui)
| role | size / line | weight |
|---|---|---|
| display | 28 / 34 | 800 |
| title | 20 / 26 | 700 |
| body | 16 / 24 | 400 |
| body-strong | 16 / 24 | 600 |
| chip | 15 / 20 | 600 |
| caption | 13 / 18 | 500 (labels 600) |

### Spacing, radius and icons
- Spacing: 8, 12, 16, 24.
- Radius: 10 for inputs, 20 for cards, 999 for chips, badges and buttons. The device frame (44) is for presentation only.
- Icons: 24px line icons, 2px stroke, round caps and joins. The set is limited to mic, back, close, copy, external link, check and plus. Check icons inside chips are 20px with a 2.5px brand stroke. Paths are in the HTML (feather-style).

## Components
- **Chip:** height 48, padding 0 20, radius 999, chip type. It has 2px borders in both states so selecting it doesn't change its size.
  - Unselected: surface-2 fill, border the same color as the fill.
  - Selected: brand-tint fill, 2px brand border, ink text, and a 20px check after the label (gap 8). Selection must read by lightness, not only by color.
  - "Your own" / "Add dish": white fill, 2px dashed ink-muted border, a 20px plus icon before the label, left padding 16.
- **Primary button:** height 52, full width, radius 999, brand fill, white body-strong text.
- **Secondary button:** height 52, white fill, 2px line border, ink text.
- **Brand-outline button:** 2px brand border, brand text (used for "Copy and open Beli" on the queue card).
- **Text button:** height 48, no fill, ink body-strong text.
- **Badge:** pill, padding 4 10, 13/18 weight 600.
  - Needs review: verdict-fine text on white (it sits on a surface-2 card).
  - Draft ready: ink text on brand-tint.
  - Loved it: 32px tall, brand-tint fill, a 16px brand check before the label.
- **Progress dots:** 7 dots, 8×8, gap 6. The active dot is 24×8 in brand. Completed dots are ink-muted. Upcoming dots are line.
- **Alec avatar:** `alec.svg` (circular, with a brand-tint background).
  - Sizes: 64 on the question screens, 48 on the queue header and the draft screen.
  - On question screens it sits in a row with gap 12: the avatar, then the name "Alec" (16/24, weight 700) above a caption line in ink-muted.

## Screens

### 1. Review queue (home)
- **Content area:** padding 8 16 0; sections are 24px apart.
- **Header:** a row with "Your dinners" (display) on the left and a 48px Alec avatar on the right. Below it, the summary "1 to review, 1 draft ready to paste." in body ink-muted, 8px below the title.
- **Cards:** stacked with a 12px gap. Cards are surface-2, radius 20, padding 16, with 16px between the info block and the buttons.
  - **Needs review:** the badge, then the name (title), then a caption "Tonight · 7:30 PM · Williamsburg". Below that, a row with gap 8: "Review now" (primary, flex 1) and "Didn't go" (secondary, auto width, 20px side padding).
  - **Draft ready:** the badge, the name, the caption "Tue, Oct 6 · 8:00 PM", and a 2-line clamped preview of the draft in quotes (body). Below that, a full-width brand-outline button with the copy icon: "Copy and open Beli".
  - **Done:** quiet, with no card fill. A 1px line border on top, 16px top padding. A 44px surface-2 circle holds an ink-muted check. Next to it, the name (16/24, weight 600, ink-muted) and the caption "Posted to Beli · Sat, Oct 3".
- **Bottom:** "Add a meal" secondary button with a plus icon.
- **Order:** Needs review first, then Draft ready, then Done (newest first within each group).

### 2. Chip question (step 2 of 7, "Vibe")
- **Top bar:** a 3-column grid (72px / 1fr / 72px) with back, the progress dots, and "Skip" (16/600, ink-muted, 44px tall).
- **Content:** padding 24 16. The Alec row (caption "Asking about Lilia, tonight"), then "What was the vibe?" (display), then the helper "Pick as many as you like." (body, ink-muted). Gap 8 inside this block.
- **Chips:** wrap with a 12px gap: Cozy, Lively, Romantic, Casual, Loud, then the dashed "Your own" chip. The questions are multi-select (single-select for Overall and Go back).
- **Bottom:** "Next" (primary).
- **Other questions** use the same template:
  - Overall (single): Loved it / It was fine / Didn't like it. Verdict colors apply only here: "fine" uses verdict-fine, "no" uses verdict-no, for the selected border and check.
  - Food: Inventive, Comforting, Perfectly cooked, Bland
  - Service: Warm, Attentive, Slow
  - Value: Steal, Fair, Pricey but worth it, Overpriced
  - Occasion: Date night, Friends, Family, Solo, Work
  - Go back? (single): Definitely, Maybe, No
- **Step order:** Overall, Vibe, Food, Service, Value, Occasion, Go back.

### 3. Notes
- **Top bar:** back on the left, the caption "Last step" in the center.
- **Content:** padding 16 16 0, gap 24.
  - The Alec row (caption "Last one, promise") with "Anything to remember?" (display) under it, gap 12.
  - The notes textarea: height 120, surface-2 fill, radius 10, padding 12 16, body text, placeholder "Best dish? Anything you'd skip?". The focus state is a 2px brand border.
  - "Favorite dishes": a caption label (600, ink-muted), then chips with gap 8. Added dishes show as selected-style chips with a check. The last chip is the dashed "Add dish".
  - The mic is centered in the remaining space: a 96px circle, brand fill, with a 36px white mic icon. The label "Tap to talk" (body-strong) sits 12px below it.
  - While listening, the mic changes to brand-tint fill, a 2px brand border and a brand icon, and the label becomes "Listening… tap to stop". Speech is transcribed and appended to the textarea.
- **Bottom:** "Write my review" as an **ink** (#14201D) primary button, because the mic is the screen's one teal element.

### 4. Draft
- **Top bar:** back on the left, close on the right.
- **Content:** padding 16 16 0, gap 24.
  - The "Loved it" badge, the Alec row at 48px (caption "Wrote this in your voice"), "Here's your draft" (display), and the caption "Lilia · N words, in your voice".
  - The draft card: surface-2, radius 20, padding 16, body text. It scrolls if the text is long.
  - A row of three equal pills, height 44, white fill with a 2px line border: Shorter / Longer / Redo.
- **Bottom:** "Copy and open Beli" (primary) with the copy icon before the label and a 20px external-link icon after it. On tap it copies to the clipboard, then deep-links or opens Beli. The label briefly changes to "Copied. Opening Beli" with a check icon. Below it, the "Save for later" text button.

## Interactions & Behavior
1. **Calendar sync:** detect dinner reservations (events from OpenTable, Resy and similar, or the keyword "dinner"). About 30 minutes after an event ends, send a push notification: "How was Lilia?". Tapping it opens step 1 for that dinner.
2. **Question flow:** back goes to the previous step, keeping its answers. Skip moves forward without saving. "Next" is always enabled (answers are optional).
3. **Didn't go:** removes the dinner from the queue (allow undo with a toast).
4. **Write my review:** sends `{restaurant, date, answers, notes, dishes}` plus a voice profile (the user's past reviews or style samples) to the LLM. Show a loading state ("Writing…", disabled button), then route to Draft.
5. **Shorter / Longer:** regenerate the draft with a length instruction. **Redo:** a new take at the same length. Keep the previous version for undo.
6. **Save for later:** returns to the queue; the card shows "Draft ready".
7. **Copy and open Beli** (queue or draft): copy the text, then open Beli. The card becomes Done.
8. **Add a meal:** a manual entry with restaurant name and date, then it goes into the flow.
9. **Error states:**
   - LLM failure: an inline message in the draft card plus a "Try again" button.
   - Mic permission denied: a caption under the mic, "Mic is off. You can still type."

## State
```
Dinner { id, restaurant, neighborhood, datetime, status: 'needs_review'|'draft_ready'|'done'|'skipped',
         answers: { overall, vibe[], food[], service[], value, occasion, goBack }, notes, dishes[], draft, draftHistory[] }
UI: currentStep (0–8), isListening, isGenerating, copied
```
Store data locally (IndexedDB) and sync through the backend for push. Persist after every answer so a closed tab can resume.

## Assets
- `alec.svg`: a hand-drawn cartoon avatar of Alec (vector, 120×120 viewBox, circular). It is the only illustration.
- Icons: inline SVG paths in the HTML (feather-style). In production, Lucide icons with the same names are fine.
- Do **not** use Beli's logo, wordmark or brand assets.

## Files
- `Dinner Notes.dc.html`: all four screens (open in a browser).
- `support.js`: the runtime that the prototype needs in order to render.
- `alec.svg`: the avatar.
