# Tally

A landscape-first timetable + attendance tracking PWA. **The timetable _is_ the
attendance interface** — tap a class cell to mark yourself present. There are only
two screens after setup: **Timetable** and **Attendance**.

## Stack

- **Vite + React + TypeScript**
- **Zustand** for state, **IndexedDB** (`idb-keyval`) + `localStorage` fallback for local-first persistence
- **vite-plugin-pwa** (Workbox) for the installable offline PWA
- **pdfjs-dist** + **tesseract.js** (both lazy-loaded) for timetable extraction from a PDF / image
- No component library — a small custom design system in `src/styles/`

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build      # tsc --noEmit + vite build (emits dist/ with sw.js + manifest)
npm run preview
```

> The build runs Vite with `--experimental-global-webcrypto` because the toolchain
> targets Node 18; on Node 20+ that flag is a harmless no-op.

## Regenerate PWA icons

```bash
npm run gen:icons
```

## How it works

- **Timetable definition** (recurring weekly classes) is stored separately from
  **attendance occurrences** (dated instances). Percentages are always _derived_
  from present/absent/cancelled occurrence records — never stored directly.
- A class that hasn't ended yet is **never** counted absent. Once its end time
  passes, an untouched class counts as absent.
- `src/lib/schedule.ts` — week math, occurrence timing, overlap lane layout.
- `src/lib/stats.ts` — attendance %, "you can miss N" / "attend the next N"
  projections, all edge cases (zero classes, perfect, below-target, unreachable).
- `src/lib/parse/` — text/OCR extraction + heuristic grid parser. Extraction is
  best-effort and always routed through the editable review screen; manual entry
  is a first-class path.
