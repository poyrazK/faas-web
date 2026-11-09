# Console bento and density pass

**Goal:** a calmer console that says less. Bento tiles instead of tables of
bordered boxes, fewer words, less precision than a person would act on, and
motion only where it acknowledges a real event.

**Branch:** `feat/overview-bento`. Long-running; ships in reviewed slices.

## Rules this pass works by

- **Say less.** A page has a title, its figures and its actions. Caveats a
  person needs before acting go behind a `HelpTip`; caveats nobody acts on go.
  Success is the norm and is not spelled out (an activity row names only
  `Failed`, `Requested`, `Cancelled` or an unknown outcome).
- **Precision people act on.** Times are relative ("3h ago"); where a date
  matters, `Timestamp mode="absolute"` shows "Today 14:03" / "Nov 2, 08:05",
  with the exact instant on hover. Money is whole cents. Counts are compact
  (934K). Logs, the wake waterfall, debugger evidence, the security audit trail
  and point-in-time restore keep full precision: diagnosis needs the seconds.
- **Tiles, not tables, for things.** Apps are `AppTile`s; a running app glows
  mint from the north-east, a never-deployed one is a hollow outline. Tables
  stay for genuinely tabular data (invoices, routes, logs).
- **Honest figures.** Only real series are charted; counts add across apps,
  percentiles never do; a degraded read is unknown, not zero.
- **Motion with restraint** (Emil Kowalski's skills, installed in
  `~/.claude/skills`): nothing enters on page load, nothing moves for style on
  surfaces people read; motion acknowledges a poll's real change or a click.
  Console tokens only (`--motion-ease`, `--motion-fast`, `--motion-base`).

## Done in this slice

- Overview: the original greeting, search and Apps / Deployments / Recents
  columns stay (Bahadir, 2026-11-09); only its Analytics section is bento cards
  (`components/dashboard/overview/`): requests stream, allowance gauge, error
  rate, cold boots, instances, CPU hours and the hour field. Shared `bento.css`.
- Projects page: project groups and standalone apps as `AppTile` grids.
- `compactTime` / `shortTime` (`lib/time.ts`); `Timestamp mode="absolute"`
  uses it; 16 console files moved off `toLocaleString()`.
- Activity tab: one line per event, raw kind and id inside Event details.
- Usage: whole-cent object-storage money; cost and forecast caveats in help.
- Metrics and Health: comparison, threshold and history caveats in help.
- Motion: refresh spins while a manual refresh runs (min 400 ms); the dot
  numeral cross-fades; a woken instance drifts in from the north-east; figures
  settle in after loading; app tile press `scale(0.99)`.

Measured (mock API, 70 surfaces): visible full timestamps 190 → about 5;
Activity 1,102 → 749 words.

## Next slices, by measured density

1. **App overview as a bento** — the most-visited page after Overview: the
   release, health and traffic as tiles (reuse the Overview figures for one
   app).
2. **Workflow schedules (597 words), Request audit, Synthetic checks, Edge
   protection, Runtime, Forks** — cut descriptions to help tips, compact the
   tables, tile where the rows are things.
3. **Usage as a bento** — allowance gauge, spend vs budget, by-app tiles.
4. **App rail** — 44 tabs in 7 groups; show the core five, fold the rest.
5. **Lists of things → tiles**: domains, buckets, Postgres databases, jobs.
6. **Re-run the density sweep** after each slice and record the numbers here.

Open: Bahadir's reference image for "too much precision" (asked for
2026-11-09; did not arrive).
