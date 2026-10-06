# CFSM Glassmorphism Agent Guide

## Scope and sources

- Read this file and `docs/CODEX_SPEC.md` before changing the project. The latter is the complete product specification and wins on scope or detail.
- Treat upstream repositories as read-only references. Do not modify files below `work/upstreams/` and do not develop through a GitHub web editor.
- Resolve conflicts in this order: current user task, `docs/CODEX_SPEC.md`, CFSM `theme-develop.md`, CFSM frontend behavior, LuminaPlus CFSM integration, then Komari Glassmorphism visual behavior.
- Preserve the current round boundary. Finish, test, and document the requested phase before starting a later one.

## Non-negotiable behavior

- Truthful data beats visual completeness. Never invent production metrics, history, IPs, ASN, provider, city, price, or location. `ip_v4` and `ip_v6` are reachability flags, not address strings.
- Use only public CFSM theme endpoints. The sole theme write endpoint is `POST /api/theme_options`; authenticated administration belongs at `/admin#admin`.
- Keep transport, parsing/adapters, stores, and UI separate. Components must not issue ad-hoc requests or reinterpret wire payloads.
- Model wire data as `unknown`, validate it at the adapter boundary, and keep TypeScript strict. Avoid `any`, unchecked casts, and hidden fallbacks.
- Preserve API-base ownership for every server. Multi-source data, WebSocket updates, detail requests, and history requests must return to the owning base.
- When WebSocket work is in scope, subscribe explicitly, merge partial updates, keep a five-minute online threshold, and close or reconnect on page visibility changes as specified.
- History periods are limited to CFSM-supported values. Surface 401, 409, and 503 truthfully; do not synthesize history.
- Theme settings have three layers: defaults, backend `theme_options`, and local overrides. Backend saves send a complete snapshot and local-only settings never masquerade as server state.
- Keep the Komari Glassmorphism visual language recognizable while adapting all runtime behavior to CFSM.
- Use the upstream icon names (Tabler / IconPark) through `AppIcon`, with paths inlined at build time in `src/constants/icons.ts`; never call an icon CDN at runtime. Flags and OS icons come from the CFSM default skin (`/flags/<code>.svg`, `/os-icons/<filename>`) and are never bundled into the theme.
- Charts run on the upstream `echarts` + `vue-echarts` stack (registered once in `src/utils/echarts.ts`), and UI primitives on `reka-ui` + `vue-sonner`. Do not replace an upstream renderer or primitive with a hand-written imitation to reduce dependencies or bundle size. Charts must keep `connectNulls: false` and must never turn a probe `false`/`null` into `0`.
- **Never put a CSS variable into an ECharts option.** The charts use `CanvasRenderer`; every colour in the option ends up on a canvas 2D `strokeStyle`/`fillStyle`, and canvas does not resolve `var(--x)` — the assignment is silently discarded and the shape keeps whatever style was set last. Round 15 found every history line rendered pure black and the in-canvas legend text rendered opaque white this way, while the HTML tooltip and the HTML summary dots — which *do* resolve variables — stayed correct, so the two disagreed. Series colours come from `src/utils/chart-palette.ts` (a verbatim port of upstream `utils/chartPalette.ts`), and the axis/legend/tooltip chrome from `getChartThemeColors(dark)` (a verbatim port of upstream `chartThemeColors`). Both are concrete values. Verify chart colour changes by reading canvas pixels with `getImageData`, not by reading the source or a screenshot.
- **Port upstream design tokens verbatim; never map them onto this theme's existing variables.** Colour scales (`--signal-1..5`), card surfaces, `--radius`, the font stack and `--selection` all come from Komari's stylesheet as-is. Re-expressing a token in local terms is a redesign, and it is how the released UI drifted before: source-level contracts kept passing while the rendered page stopped matching. When a value is visual, read the upstream CSS for the value that actually wins at runtime — upstream overrides Tailwind utilities with `!important` in places — and copy that, not the utility class it appears to use.
- **Komari Glassmorphism is the single source of truth for the released UI and UX.** Its current default-branch code, components, styles, layout, animation, routing behavior and browser output define what this theme must look like and how it must behave. The existing CFSM-Glassmorphism implementation records which CFSM features already work; it is *not* the visual truth and is never a protected baseline. Where the two differ, align to Komari unless the difference is a required CFSM platform difference (REST/WebSocket/history/`theme_options`/multi-apiBase/JWT/Turnstile/dist rules/missing CFSM fields/hash routing/truthful degradation). "Better UX", "fits CFSM better" and "simpler code" are not valid reasons to diverge, and renderers Komari actually uses must not be swapped for imitations to reduce dependencies or bundle size. Record every audited difference in `docs/fidelity-audit.md` with a P0/P1/P2 priority.

## Delivery discipline

- Bun is the package manager. Do not mix npm, pnpm, or yarn lockfiles into the repository.
- Do not commit generated `dist/`, dependency directories, audit clones, or scratch output.
- Before handing off a code change, run `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`, and `bun run validate:dist`.
- **On Windows, `bun run typecheck` does not actually check SFC templates.** `vue-tsc` under Bun fails to load the Vue language plugin there, reports four `TS2307: Cannot find module './App.vue'`-style errors and stops before any `.vue` file is analysed. Earlier rounds recorded this as a harmless flake; round 13 proved it hides real template type errors that then fail on CI. Do not treat those four errors as "the known issue and therefore fine". Re-run the same check with a portable Node kept outside the repository — `<node>/node.exe node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.json` — which does analyse templates, and fix whatever it reports before pushing. Never change `package.json`, `bun.lock`, `tsconfig` or CI to work around either symptom.
- A development round is complete only after lint, typecheck, test, build, and dist validation all pass and that round's work is committed and pushed to the target repository. Never enter the next round before the current round has been pushed successfully.
- CI must use a frozen Bun install and validate that the release archive contains only `index.html` plus `assets/` at its root.
- Release notes under `docs/releases/` must be written in Chinese for v1.0.0 and all subsequent versions.
- Update the compatibility matrix, API mapping, architecture notes, and settings audit whenever a relevant contract changes.
