# CHANGELOG — v2.1

Every change from the v2.0 baseline, grouped by the suggestion it addresses.
Review these before deploying. Nothing here changes your prompt output — the
JSON/text a clip produces is byte-for-byte the same; these are structural,
safety, and workflow improvements.

---

## 1. Legacy file out of the deploy path
- Moved `prompt-builder.html` → `archive/prompt-builder.legacy.html`.
- Added `archive/README.md` ("do not deploy") explaining it's the old
  login-less single-file build kept only for reference.
- **Why:** opening the wrong file gave a totally different app with no auth.

## 2. Recreate split into its own file
- New `recreate.js` holds all Recreate-mode UI + logic (~190 lines that used to
  live inside `gemini.js`).
- `gemini.js` now exposes a small bridge, `window.PBGemini`
  (`ensureKey, openPanel, addMsg, apiCall, fileToScaledB64, imgPart, stripFences`),
  which `recreate.js` consumes.
- Removed `injectRecreateMode()` and `recreateGo()` from `gemini.js`.
- **Why:** a syntax error in Recreate no longer takes down chat + vision with it.

## 3. Field-id contract
- New `PB.FIELDS` map in `pb-core.js` is the single source of truth for every
  element id that JS reaches into; `PB.hk(part, letter)` derives hook ids.
- `gemini.js` and `recreate.js` now read ids from `PB.FIELDS` instead of literals.
- **Why:** rename a field in the HTML in one place instead of hunting through
  three JS files for silent breakages.

## 4. Centralized, friendly API errors
- New `PB.fmtApiError(err, status)` returns specific messages for: no key,
  invalid key (400), unauthorized (401/403), rate-limit/quota (429), server
  (5xx), model-not-found (404), and network failures.
- `apiCall` in `gemini.js` now attaches the HTTP status to thrown errors.
- All catch sites in `gemini.js` and `recreate.js` route through it.
- **Why:** "Error: [object]" became "Gemini is rate-limited or out of free quota
  — wait a minute and try again."

## 5. IndexedDB for large images
- New `PB.blobStore` (IndexedDB key/value) in `pb-core.js`.
- The Recreate person photo now persists there (`recreate_person`) instead of in
  `localStorage`.
- One-time migration `PB.migrateLegacyRecreatePhoto()` moves any old
  `pb_recreate_person` value over, then clears it.
- **Why:** a big base64 photo could blow the ~5MB `localStorage` budget shared
  with your synced state.

## 6. HTML escaping
- `PB.escapeHtml` is the one canonical escaper (escapes & < > " ').
- `system.js` `vbVideoBlock` and the segment preview now escape **all** dynamic
  content (label + JSON + user clip text), not just `<`.
- `gemini.js` keeps its local `escapeHtml`; `presets.js` uses `PB.escapeHtml` for
  preset names.
- **Why:** user/synced text reaching `innerHTML` is now fully escaped.

## 7. Named presets (new feature)
- New `presets.js` + a styled preset bar under the header.
- Save / load / update / rename / delete full builder configs (a complete
  `vbCollect()` snapshot).
- Stored in `localStorage` (`pb_presets`) and mirrored into
  `pb_state.__presets` so they sync across devices with no DB schema change.
- Exposes `window.PBPresets` (`saveAs, apply, remove, list`).
- **Why:** this is the core loop for Cassidy / Darius / Dorian — pick a name,
  the whole locked config loads.

## 8. Forgot-password
- `login.html` gains a "Forgot password?" link → `resetPasswordForEmail`.
- Handles the `PASSWORD_RECOVERY` auth event to let users set a new password.
- Status line now supports a green "ok" state.

## 9. Build stamp
- `pb-core.js` carries `PB.VERSION` + `PB.BUILD`; the footer renders
  `v2.1 · <date> <hash>` (or `v2.1 · dev` if unstamped).
- New `stamp-build.sh` writes the date + git short-hash before deploy.
- **Why:** confirm at a glance that GitHub Pages actually served the new build
  (fixes the "saving locally ≠ deployed" + cache confusion).

## 11. Character editor polish
- "Name" renamed to **Avatar name**.
- Character label auto-fills from the avatar name when left blank (so the JSON
  `character` key is never empty).
- **~40 words** button rewrites the description tight via Night Chat; a live word
  counter turns amber past 60 words.
- Roster supports **drag-to-reorder** (order persists + syncs); no longer forced
  alphabetical.

## 12. Photo editor (Lightroom) — new feature
- New `lightroom.js` + bottom-right **Edit photo** launcher.
- Full-screen, browser-only canvas editor; nothing is uploaded.
- Light (exposure/contrast/highlights/shadows/whites/blacks), Color
  (temp/tint/saturation/vibrance), Detail (clarity/sharpen/vignette), plus 8
  filters and rotate/flip.
- Press-and-hold = before/after; double-click a slider to reset it.
- Live preview downscaled for speed; **Download** exports full-res PNG/JPG.
- Sits bottom-right so it doesn't collide with Night Chat (bottom-left).
- Adds **HSL** (8-band Hue/Sat/Lum), a draggable **tone curve** (RGB + per-channel
  R/G/B, monotone-cubic LUT), and **Grade** (shadow/mid/highlight color balance).
  Each block only runs when non-default, so untouched tools cost nothing.

## 13. Body Script + Clip merged into one Clip mode
- `modeSelect` no longer has separate "Body Script" and "Clip" options — just
  one **Clip** mode.
- New "Clip type" dropdown inside the Clip card: **Multiple clips** (the old
  Body Script auto-splitter, pacing controls, rough-cut preview) or **Single
  clip** (the old Clip mode — one line, no splitting).
- Both clip types now read from the same `scriptText` field — no more
  retyping your line when switching between them. The standalone `scriptOne`
  field is retired.
- `vbApply()` migrates old saved presets/characters/synced state automatically:
  `mode:'single'` + `scriptOne` is folded into `mode:'script'` +
  `clipType:'single'` + `scriptText`, so existing presets keep working with no
  manual re-saving required.
- `PB.FIELDS.scriptOne` removed from the field-id contract; `PB.FIELDS.clipType`
  added.
- **Why:** the two modes were always the same JSON builder (`vbJson()`) fed by
  two different fields — that duplication meant double the code paths and a
  retyped line every time you switched. Now it's one mode, one field, one
  picker.

## 14. Sticky two-column layout (inputs left, preview right)
- `.vb-wrap` is now a real two-column CSS grid (`.vb-col-left` / `.vb-col-right`)
  instead of the old Pinterest-style `columns:` masonry, where a card's column
  was just whatever the height-balancing happened to pick.
- Every mode now follows the same split: **left** = the fields you edit,
  **right** = locked guarantees + the JSON/text output preview.
- Image, Product, and Hook each had their preview embedded at the bottom of a
  bigger input card — those are now their own card on the right (no JS
  behavior change; same element ids, just moved).
- `.vb-col-right` is `position: sticky`, offset below the header by a
  `--header-h` custom property that a small `ResizeObserver` in `system.js`
  keeps in sync (so it still lines up correctly once the preset bar adds a
  row to the header). Caps at viewport height with its own scroll if the
  preview stack is taller than the screen.
- Below 900px it collapses back to a single stacked column (sticky doesn't
  make sense on mobile), same as before.
- `characters.js` and `recreate.js` now inject into `.vb-col-left` instead of
  `.vb-wrap` directly (falls back to `.vb-wrap` if `.vb-col-left` is absent).
- **Why:** you used to have to scroll past the input cards to see the JSON
  preview, even though there was empty space next to them. Now the preview
  for whatever mode you're in is always in view while you edit.

---

## Files added
`pb-core.js`, `recreate.js`, `presets.js`, `characters.js`, `lightroom.js`,
`stamp-build.sh`, `archive/prompt-builder.legacy.html`, `archive/README.md`,
`CHANGELOG.md`

## 10. Character Library (new feature — requested after v2.1)
- New `characters.js` + a "Characters" roster card at the top of the builder.
- Each character = photo + name + short character label + description.
- Add/edit modal with photo upload and a "Describe" button (uses Night Chat to
  write the description from the photo).
- Picking a character fills the identity fields for the **current mode** and
  follows you across mode switches:
  - Body Script / Clip / Image / Recreate → `character` + Description
  - Hook → Person A's character + description
  - Product → product reference
- Photos in IndexedDB (`char_img_<id>`); metadata in `localStorage`
  (`pb_characters`) mirrored to `pb_state.__characters` for sync.
- Exposes `window.PBCharacters` (`list, apply, add`).
- Fix: mode is detected via the live mode value, not `window.vbModes` (which is
  a `const` global and never attaches to `window`) — previously a character
  loaded in Product/Hook/Image silently wrote to the script fields and the
  visible JSON didn't change. Saving a character now also auto-loads it into the
  current mode's preview, and the preview refreshes immediately (bypassing the
  perf.js debounce).
- **Why:** for the Cassidy / Darius / Dorian workflow, switching *who* the video
  is about is a one-tap action that works in every mode — lighter and more
  intuitive than a full preset.

---

## Files changed
`index.html` (script order + footer), `style.css` (preset bar, footer, character
roster + modal), `system.js` (escaping), `gemini.js` (recreate removed, bridge
added, errors, field contract), `login.html` (forgot-password), `README.md`

## Files unchanged
`hook-people.js`, `perf.js`, `sync.js`, `supabase-config.js`, `theme-glass.css`

---

## Test before you ship
1. Hard-refresh the live site; footer should show the new build stamp.
2. Save a preset named "Cassidy", change some fields, then reload it — fields
   should snap back.
3. Open Night Chat with a bad/empty key — you should get the friendly message,
   not a raw error.
4. Recreate mode: upload a scene + person, generate, reload the page — the person
   photo should still be remembered.
5. Forgot-password: enter your email, tap the link, check for the reset email.
