# chem-review-pwa

A tiny PWA MVP for reviewing Taiwanese high-school (Grade 10) chemistry via a simple loop:
**diagnostic → weakness ranking → 7‑day plan → daily tasks (concept + practice) → recap**.

## What’s inside

- React + Vite + Tailwind
- PWA (vite-plugin-pwa)
  - Offline cache (Workbox)
  - Auto-update + in-app “new version available” prompt
- Local persistence (localStorage)
  - Export/import progress as JSON
  - Export a shareable text summary (weakest Top 3 + plan progress)

## Quick start

```bash
npm install
npm run dev
```

## Build / preview

```bash
npm run build
npm run preview
```

## Checks (lint + build)

```bash
npm test
# or
npm run check
```

## Version + build timestamp

During build, `vite.config.js` injects:

- `__APP_VERSION__` (from `package.json`)
- `__BUILD_TIME__` (ISO timestamp at build time)

The app shows these in the bottom-right “最後部署 / vX.Y.Z” badge.

## Notes

- This repo is intentionally an MVP; the question bank is currently a small demo set.
- The PWA install button only appears when the browser fires `beforeinstallprompt` (mostly Chromium-based browsers).

## Handy UX (MVP quality-of-life)

- **Diagnostic keyboard shortcuts (desktop):**
  - `1–4` or `A–D`: choose answer
  - `←/→`: previous/next question (→ requires answered)
  - `Enter`: next / submit at the end
  - `C`: clear current answer
  - `J`: jump to first unanswered
  - `?` or `H`: open shortcut help
  - `Esc`: close help / exit diagnostic

- **Global shortcuts (desktop, outside diagnostic):**
  - `P`: export progress JSON
  - `S`: export share summary (text)
  - `I`: import progress from clipboard (falls back to paste prompt if permissions disallow)
  - `T`: scroll to top

- **Task view shortcuts (desktop, in “daily tasks”):**
  - `←/→`: previous/next day
  - `N`: jump to next incomplete day
  - `1`: toggle Concept done
  - `2`: toggle Practice done (requires all answers revealed)
  - `R`: reveal next unrevealed answer (and jump)
  - `Shift+R`: toggle reveal/hide all answers

- **Progress import options:**
  - Import from clipboard (when permissions allow)
  - Import from a JSON file
  - **Drag & drop** an exported progress JSON anywhere on the page (desktop)

- **Backup tip:** if localStorage is unavailable (privacy mode / disabled), the app will show a warning banner and you should regularly use **Export progress (JSON)**.
