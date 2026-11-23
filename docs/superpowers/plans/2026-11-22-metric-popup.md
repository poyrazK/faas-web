# Metric popup: answer first, live window, one action

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The popup that opens from a chart or metric card answers "is this normal, when did it change, what caused it, what do I do" in that order, and the Overview's analytics cards open it.

**Why (user report, 2026-11-22):** "it doesnt work and that popup is so messy i cannot understand anything".

- **Frozen window.** The popup copies the page's exact `from`/`until`, so Refresh re-reads the same hours.
- **Dead end.** The empty state says "Try another time range", but the popup has no window control.
- **Two titles and jargon.** "end exclusive", "First 11 complete hours vs Last 11 complete hours", "Leading contributors", with Refresh as the main button.
- **Overview cards open nothing.**

**Approved design:** the mockup in the conversation, which has two views:

- **App view:** answer, chart with the busiest hour marked, where they came from, one action.
- **Account view:** answer, apps ranked, one action.

## Global Constraints

- **Live windows.**
  - Openers pass the preset (`24h`), never `from`/`until`, so the popup always runs up to now.
  - A timestamp window from an older URL still validates and reads as "Custom window". Picking a preset replaces it.
- **Popup window choices:** 1h · 24h · 7d. A preset the opener passed that isn't in the list (5m, 6h, 15d) shows as an extra selected option. Changing the window keeps the metric, app and route.
- **CLAUDE.md analytics rules hold:**
  - Account scalars get no chart.
  - Hourly percentiles are never averaged; latency gets no before/after verdict, only its slowest hour.
  - Comparisons use `compareRequestHalves`, i.e. equal groups of complete hours.
  - Chart hours are UTC, said once.
- **Verdict chips:**
  - **Counts** (requests, errors, cold boots) use the halves delta: within ±15% is "Steady"; up is "Busier than earlier" (requests) or "More failures than earlier" (errors, warning); down is "Quieter than earlier" or "Fewer failures than earlier" (good).
  - **Error rate:** 0 → "No failures" (good); <1% → "Healthy" (good); <5% → "Worth a look" (warning); otherwise "High" (critical).
  - **Anything else** gets no chip.
- **One action:** a Debugger link on the app: tab `Debugger`, `debugView: 'requests'`, the window mapped to 1h/24h/72h, `debugFilter` failed/slow/cold by metric, and `debugQuery` set to the focused route.
- **Details on request:** the exact UTC window, the hourly table and the top-groups note sit in one `<details>` ("Exact window and hourly numbers"). Retention and incomplete-telemetry notes stay visible, in plain words.
- **Modal:** title `Metric · app` (account: the metric alone), no description, `max-w-3xl`.
- **Verify:** `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `npx vitest run --maxWorkers=6`, `npm run build`.

## Tasks

### Task 1: Pure story helpers (`metric-story.ts` + test)

- [ ] `POPUP_WINDOWS`, `windowLabel(since)` ("Last 24 hours", "Custom window"), `windowOptions(since)`.
- [ ] `countVerdict(metric, comparison)`, `rateVerdict(pct)`, `busiestHour(metric, points)`.
- [ ] `debuggerSearch(metric, since, route?)`.

### Task 2: Chart marks and picks (`kit/chart.tsx`)

- [ ] `marked?: number` draws an accent marker labelled "Busiest".
- [ ] `onPick?: (index) => void`: a click or Enter picks the hovered hour.

### Task 3: App view

- [ ] Window picker; answer (number, chip, sentence); chart with the busiest hour and the picked-hour line.
- [ ] Sources with Route · Status · Country tabs and a More select; share % for counts.
- [ ] Route focus chip; the Debugger action; details.
- [ ] Tests updated.

### Task 4: Account and resource views

- [ ] **Account view:** window picker, answer and verdict, "{top} had X% of them", apps ranked, and an action to the top app's Debugger for error metrics.
- [ ] **Resource view:**
  - memory: "Apps using the most memory" from instances × apps, with a link to Instances;
  - GB-hours and CPU: plain sentence plus a link to Usage.

### Task 5: Overview cards open the popup

- [ ] `StatCard` gets `onOpen` and renders as a button labelled "See {label} details".
- [ ] `OverviewStats` gets `onInspect(metric)`.
- [ ] `dashboard.index.tsx` passes `inspect({ metric, since: range, source: 'rollup' })`.
- [ ] Openers stop passing `until`: `app-analytics.tsx` and `app-analytics-preview.tsx` pass the preset.

### Task 6: Gate, mock check, review, PR
