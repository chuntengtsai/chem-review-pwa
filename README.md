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
