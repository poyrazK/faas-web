# Task 2 report: controlled app analytics body

## Status

Complete.

## Changes

- Extracted and exported AppAnalyticsBody, a controlled analytics panel that
  accepts the selected window, grouping, optional paired route/method filter,
  and the three account-page change handlers.
- Kept AppAnalyticsPanel({ slug }) as the existing Metrics-tab adapter. It
  owns the same default window and grouping state and delegates rendering to
  the controlled body.
- Passed the grouping to the timeseries query and passed a route/method only
  while route grouping has a complete selection. The active selection renders
  as a visible clearable chip.
- Made route rows clickable and keyboard-operable with Enter or Space only
  for route grouping. Other grouping rows remain ordinary table rows.
- Replaced ad hoc request-state branches with queryPhase for the aggregate,
  timeseries, and grouped-table reads. The existing PlanGated behavior now
  covers either analytics query error; chart rendering remains limited to a
  real multi-point series.
- Added focused tests for route selection, keyboard selection, paired
  timeseries filtering, clear behavior, and grouping-driven filter clearing.

## TDD evidence

### RED

Command:

    /home/bahadir/.nvm/versions/node/v22.22.3/bin/node node_modules/vitest/vitest.mjs run src/components/dashboard/app-analytics.test.tsx

Relevant output before production edits:

    src/components/dashboard/app-analytics.test.tsx (8 tests | 3 failed)
    Error: Element type is invalid ... got: undefined.
    You likely forgot to export your component from the file it is defined in.

The three controlled-body tests failed because AppAnalyticsBody had not yet
been exported.

### GREEN

Commands:

    /home/bahadir/.nvm/versions/node/v22.22.3/bin/node node_modules/vitest/vitest.mjs run src/components/dashboard/app-analytics.test.tsx
    /home/bahadir/.nvm/versions/node/v22.22.3/bin/node node_modules/typescript/bin/tsc --noEmit

Relevant output:

    Test Files  1 passed (1)
    Tests  8 passed (8)

## Verification

- Focused app-analytics tests: 1 file, 8 tests passed.
- Full suite command:

      /home/bahadir/.nvm/versions/node/v22.22.3/bin/node node_modules/vitest/vitest.mjs run

  Passed: 74 files, 458 tests.
- TypeScript check passed.
- ESLint on changed files passed.
- Prettier check on changed files passed.
- git diff --check passed.

The direct Linux Node binary was used because the shell resolves npm to the
Windows shim, which cannot execute from this WSL worktree UNC path.

## Files

- src/components/dashboard/app-analytics.tsx
- src/components/dashboard/app-analytics.test.tsx
- .superpowers/sdd/account-analytics/task-2-report.md

## Self-review

- The legacy Metrics-tab API is unchanged: AppAnalyticsPanel still receives
  only slug and retains the original 24h/route defaults.
- A route filter can never be sent without its method, matching the normalized
  query contract from Task 1.
- Grouping transitions clear filters before a non-route table can expose a
  selectable row. A route row without a method is also deliberately not
  selectable.
- The chart receives a route/method pair when selected and does not render
  for zero or one points.
- Plan access continues to use the shared PlanGated error-code convention;
  general API and unreachable errors use the shared queryPhase rendering.

## Concerns

None.
