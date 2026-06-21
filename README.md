# GenFlow v2 — Prompt Builder

A static web app that builds locked-identity prompts for AI video/image generation
(Google Flow / Veo, image models). It turns form inputs into ready-to-use JSON and
plain-text prompts, with an optional Gemini assistant, multi-person dialogue support,
accounts, and cross-device sync.

Live: `https://r4shberry.github.io/genflow-v2/`

---

## What it does

The core app is **AI-free** — it assembles prompts from your selections using
templates. The AI features (Gemini) are an optional convenience layer on top.

**Modes** (top-right dropdown):

| Mode | Output | Uses AI? |
|------|--------|----------|
| Clip | Single line → one clip JSON, **or** a full script auto-split into ~8s clip JSONs (paged preview) — toggled via the "Clip type" dropdown inside the mode | No |
| Hook | Two-or-more-person dialogue, per-line speaker/camera/accent → clip JSONs | No |
| Image | Full scene/wardrobe/pose/companion image JSON + negative prompt | No |
| Image Fixer | img2img "realism pass" prompt to remove the AI look | No |
| Product | Plain-text prompt of the locked subject holding a product | No |
| Recreate | Scene photo + person photo → plain-text Flow recreate prompt | Yes (Gemini) |

**Night Chat** (bottom-left launcher): a Gemini assistant with multi-turn memory,
live web search, image attach, photo→JSON, and a Scenes button (script → image + video
prompt per scene).

**Accounts + sync**: email login (Supabase) gates the app and syncs your builder
settings across devices.

---

## File structure

| File | Role |
|------|------|
| `index.html` | UI shell — all cards and option dropdowns |
| `login.html` | Standalone login / sign-up / forgot-password page (gates the app) |
| `style.css` | Base dark theme (incl. preset bar + footer version) |
| `theme-glass.css` | Optional: animated aurora background + grey frosted-glass cards |
| `supabase-config.js` | Shared Supabase client (URL + publishable key) |
| `pb-core.js` | Shared foundation: field-id contract, escapeHtml, friendly API errors, IndexedDB blob store, build stamp |
| `system.js` | Core engine: modes, prompt builders, segmentation, persistence |
| `gemini.js` | Night Chat, photo→JSON, describe-from-photo, downscaling; exposes `window.PBGemini` |
| `recreate.js` | Recreate mode (scene + person → Flow recreate prompt); consumes `window.PBGemini` |
| `hook-people.js` | Adds Person C–F to Hook mode (generalizes the A/B logic) |
| `presets.js` | Named presets — save / switch full builder configs (e.g. Cassidy, Darius, Dorian) |
| `characters.js` | Character Library — image + name + description, loads identity into any mode |
| `lightroom.js` | In-browser photo editor — live sliders, filters, before/after, download (no AI) |
| `sync.js` | Auth guard + cross-device sync + account bar |
| `perf.js` | Debounces the live-preview rebuilds for smooth typing |
| `stamp-build.sh` | Writes date + git hash into the footer build stamp before deploy |
| `archive/` | Old single-file build — **never deployed** |

### Script load order (in `index.html`)

Order matters. `pb-core.js` must come first (everything else reads `PB.*`).
`gemini.js` must come before `recreate.js` (which uses its bridge). `presets.js`
must come before `sync.js` so the preset library is part of `pb_state` when sync
pushes. `perf.js` is last so it wraps the final render functions.

```html
<link rel="stylesheet" href="css/style.css">
<link rel="stylesheet" href="css/theme-glass.css">
...
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="js/core/supabase-config.js"></script>
<script src="js/core/pb-core.js"></script>
<script src="js/core/system.js"></script>
<script src="js/ai/gemini.js"></script>
<script src="js/ai/recreate.js"></script>
<script src="js/ai/gemini-lab.js"></script>
<script src="js/ai/puter-image.js"></script>
<script src="js/ai/puter-chat.js"></script>
<script src="js/ai/lab-hub.js"></script>
<script src="js/features/hook-people.js"></script>
<script src="js/features/camera-angle.js"></script>
<script src="js/features/presets.js"></script>
<script src="js/features/characters.js"></script>
<script src="js/features/lightroom.js"></script>
<script src="js/features/mode-router.js"></script>
<script src="js/core/sync.js"></script>
<script src="js/core/perf.js"></script>
```

`login.html` only needs the Supabase CDN + `supabase-config.js`.

---

## Setup

### 1. Supabase (accounts + sync)

### 2. Gemini (optional AI features)

Get a free key at `aistudio.google.com/apikey`. Paste it into the 🔑 field inside
Night Chat. It is stored only in your browser, never committed.

### 3. Deploy

Push to GitHub; Pages serves the repo. Before deploying, stamp the build so the
footer shows the date + commit (lets you confirm the live site actually updated):

```bash
./stamp-build.sh && git add -A && git commit -m "deploy" && git push
```

Wait ~1 min, then hard-refresh (Ctrl+Shift+R) since Pages and the browser both
cache. The footer at the bottom of the app should show the new date/hash.

---

## How sync works

- On login, the guard in `sync.js` checks the session; no session → redirect to
  `login.html`.
- Builder state lives in `localStorage` under `pb_state`. On change it's pushed to
  the `profiles` table (debounced); on login it's pulled back.
- Conflicts are resolved last-write-wins by timestamp, so a fresh device won't
  clobber newer work.
- The Gemini key (`pb_gemini_key`) and chat history (`pb_nightchat`) stay local per
  device — they are **not** synced.

## Named presets

The preset bar (under the header) saves the **entire** builder config — every
field, toggle, companion chip, product preset and hook line — under a name, then
reloads it in one tap. Built for the multi-character workflow: save "Cassidy",
"Darius", "Dorian" once, then switch between them instantly.

- **Save** snapshots the current settings as a new named preset.
- Selecting a preset from the dropdown loads it.
- **Update** overwrites the selected preset with the current settings; **Rename**
  and **Delete** do what they say.
- Presets are stored in `localStorage` (`pb_presets`) and mirrored into
  `pb_state.__presets`, so they ride the existing cross-device sync with **no
  schema change**.
- Known limitation: loading a preset restores Person A/B reliably; extra Hook
  persons (C–F) restore only if those cards already exist on the page.

## Character Library

The **Characters** card at the top of the builder is a roster of reusable
identities — each with a photo, a name, a short character label, and a detailed
description. It is mode-independent: pick a character and it fills the identity
fields for whatever mode you're in, then "follows" you when you switch modes.

- **Add** opens an editor: upload a photo, type a name + description, or tap
  **Describe** to have Night Chat write the description from the photo.
- Clicking a character loads it into the current mode:
  - Clip / Image / Recreate → Character + Description fields
  - Hook → Person A's Character + Description
  - Product → the product-mode reference field
- The active character gets an accent ring and a dot; switching modes re-applies it.
- Photos are stored in IndexedDB (`char_img_<id>`); names/descriptions in
  `localStorage` (`pb_characters`) mirrored into `pb_state.__characters` for sync.
- The raw photo is **not** embedded in the JSON — Flow/Veo takes it as a separate
  upload. The character's text (name → `character` key, description →
  `image_reference` / Description) is what flows into the prompt.

Presets vs Characters: a **preset** saves your *whole* config (every field, mode,
scene setting); a **character** saves just an identity and drops it into any mode.
Use characters to switch *who* the video is about, presets to switch an entire
setup.

## Photo editor (Lightroom)

A bottom-right **Edit photo** launcher opens a full-screen, browser-only image
editor — no AI, no upload, nothing leaves the device. Open or drag in a photo,
adjust, and download the full-resolution result as PNG or JPG.

- **Light:** exposure, contrast, highlights, shadows, whites, blacks
- **Color:** temperature, tint, saturation, vibrance
- **Curve:** draggable tone curve — RGB master plus per-channel R/G/B (click to add
  a point, drag to move, drag off to remove; monotone-cubic interpolation)
- **HSL:** per-color Hue/Saturation/Luminance for 8 bands (red, orange, yellow,
  green, aqua, blue, purple, magenta) — the tool for skin tones and color matching
- **Grade:** shadows / midtones / highlights color balance (Cyan–Red, Magenta–Green,
  Yellow–Blue per zone)
- **Detail:** clarity, sharpen, vignette
- **Filters:** Original, B&W, Warm, Cool, Film, Vivid, Matte, Noir — plus rotate
  and flip
- Press-and-hold the image to see the original (before/after).
- Double-click any slider to reset just that one; **Reset** clears all.
- Live preview is downscaled for speed; the **Download** runs the full pipeline at
  native resolution.

For generative relighting / removing the AI look, that's a different job — use
**Image Fixer** mode, which writes an img2img prompt you run through an image
model. The photo editor is for manual tonal/color correction only.

---

## Security notes

- The Supabase **publishable** key is safe in client code — it's protected by Row
  Level Security. **Never** commit the `sb_secret_...` key.
- The login is a **client-side gate**: it controls the normal flow and triggers sync,
  but it does not prevent someone from downloading the static files. True protection
  of the prompt-building logic would require moving it to a server/serverless API.
- With email confirmation off, anyone can sign up with any address. Fine for testing
  and watching usage; turn confirmation back on for a real launch.

---

## Maintenance gotchas (learned the hard way)

- **Edit in one place.** Don't edit files both on the GitHub website and locally —
  that creates diverging commits and `! [rejected] ... fetch first` push errors.
  If you hit one: `git pull origin main --no-rebase` then `git push origin main`.
- **"Login totally gone"** almost always means the deployed `supabase-config.js`
  still has placeholders or a **truncated key** (ending in `...`). When `sbClient`
  is null, `sync.js` runs the app open by design. Verify the live file at
  `.../supabase-config.js`.
- **Saving locally ≠ deployed.** Changes only reach the live site after commit +
  push + Pages rebuild + hard-refresh.
- **Field IDs are hardcoded** in `gemini.js` / `hook-people.js` (`#character`,
  `#imgRef`, `#hkRefA`, `#scriptText`, etc.). Renaming a field in the HTML silently
  breaks those hooks.

---

## Watching usage

- **Authentication → Users**: everyone who signed up (email, join date, last login).
- **Table Editor → `profiles`**: one row per user; `state` is their synced settings.

---

## Ideas / backlog

Done in v2.1: named presets, forgot-password link, Recreate split into its own
file, field-id contract, IndexedDB for large images, friendly API errors, build
stamp.

Still open:
- "× N variations" control inside Image and Product modes (batch prompts).
- Product B-roll (one product → a set of shot prompts).
- Frost the Night Chat / login panels to match `theme-glass.css`.
- Restore extra Hook persons (C–F) from a preset even when their cards don't
  exist yet on load.
