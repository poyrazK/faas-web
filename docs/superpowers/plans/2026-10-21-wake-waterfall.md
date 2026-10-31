# Wake Waterfall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the console's plain wake-event list with a two-tier waterfall (a real time axis of `wake.*` milestones plus an attribution breakdown of restore, cold-boot or thaw phases), opened in a right-side drawer with a shareable `?wake=` URL from the recent-wakes panel, the debugger and instance detail.

**Architecture:** A pure parser (`src/lib/wake-anatomy.ts`) turns raw frames into typed generations. A `WakeWaterfall` component renders one generation. `WakeDrawer` hosts it in the shared `Modal` with a new right placement. Host pages read and write the `wake` search param; shared components take callbacks, so none of them needs router links.

**Tech Stack:** React 19, TanStack Router and Query (`useInfiniteQuery`), `motion/react`, Tailwind, Vitest + React Testing Library, the Vite dev mock in `mock/plugin.ts`.

**Spec:** `docs/superpowers/specs/2026-10-21-wake-waterfall-design.md`. Read it before starting, including its "Revisions" section, which records the corrections found while writing this plan.

## Global Constraints

- Work in `/home/bahadir/GREGALE/.worktrees/faas-web-wake-waterfall`, branch `feat/console-wake-waterfall`. Never `cd` to `/home/bahadir/GREGALE/faas-web`.
- Read `CLAUDE.md` and `README.md` in the worktree first.
- No literal hex colours and no `dark:` variants in components (`src/lib/conventions.test.ts` enforces this). Colours come from existing tokens: `var(--status-good)`, `var(--status-warning)`, `var(--status-serious)`, `var(--status-idle)`, `bg-brand`, `text-brand`, `text-muted-foreground`. No new tokens.
- Read states go through `queryPhase()` and `InlinePhase` from `src/components/dashboard/primitives.tsx`. Never write the loading/empty/error ternary by hand.
- A 402 renders the existing `PlanGated` component with `feature="Wake timeline"`.
- Never hand-edit `src/routeTree.gen.ts` or `src/lib/api/schema.d.ts`.
- Every API call must exist in `api/openapi.yaml`. The per-wake endpoint takes only `since` and `limit` query parameters.
- No fixture data in `src/` outside tests. Test-only frames live in `src/test/wake-frames.ts`.
- Do not reformat files you did not otherwise change. Run Prettier only on touched files.
- Tests: Vitest + React Testing Library, beside the code. Run with `npx vitest run --maxWorkers=8`. A run passes only when the exit code is 0 **and** the summary has no "Errors" line.
- `npm run lint`: 0 errors, no more than the existing 4 warnings.
- Commits: conventional (`feat(console): …`, `test(console): …`, `docs(console): …`), each with a body that says why. Use the repo's configured git identity. **Do not push.**

## Review Focus

The inputs most likely to bite a real person that the spec does not spell out. Each has a test in the task named.

1. **Frames with no `data`.** Older rows and some test doubles omit `data` or set it to `null`. The parser must treat that as an empty object: no crash, no stage dropped. Test in Task 1.
2. **A breakdown with a zero or missing `total_ms`.** Shares must be 0, the summary must not print `NaN%`, and the overlap note must not appear. Tests in Tasks 1 and 2.
3. **A long-lived frozen VM with more than 1,000 frames.** "Load later frames" appends the next page. The boundary frame, which `since` returns again because it is inclusive, must not be counted twice. Test in Task 2.
4. **A pasted Analytics link with `wake` but no `app`.** The page must render normally with no drawer, because the API needs an app slug. Test in Task 3, on `WakeDrawer`.
5. **Opening a wake while the debugger's request-evidence dialog is open.** Exactly one dialog may be on screen, and closing the drawer must bring the evidence back. Test in Task 4.

## File Structure

| File                                                                                   | Responsibility                                                    | Task |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---- |
| `src/lib/wake-anatomy.ts` (new)                                                        | Pure parser: frames → generations, labels, constants              | 1    |
| `src/test/wake-frames.ts` (new)                                                        | Canonical test frames shared by parser and component tests        | 1    |
| `src/lib/wake-anatomy.test.ts` (new)                                                   | Parser tests                                                      | 1    |
| `src/lib/api/queries.ts`                                                               | `useWakeTimeline` becomes an infinite query over `since`          | 2    |
| `src/components/dashboard/wake-waterfall.tsx` (new)                                    | The two-tier view for one wake                                    | 2    |
| `src/components/dashboard/wake-waterfall.test.tsx` (new)                               | Component tests                                                   | 2    |
| `src/components/dashboard/instance-detail.tsx`                                         | Renders `WakeWaterfall` inline                                    | 2    |
| `src/components/dashboard/wake-timeline.tsx`                                           | Deleted                                                           | 2    |
| `src/components/ui/modal.tsx`, `modal.test.tsx`                                        | `placement="right"`                                               | 3    |
| `src/components/dashboard/wake-drawer.tsx`, `wake-drawer.test.tsx` (new)               | Drawer host for one wake                                          | 3    |
| `src/components/dashboard/debug-search.ts`                                             | `wake` search param                                               | 4    |
| `src/components/dashboard/debug-request-evidence.tsx`, its test                        | "Wake" row with an open button                                    | 4    |
| `src/components/dashboard/debug-body.tsx`                                              | Evidence steps aside while a wake is open                         | 4    |
| `src/routes/dashboard.debug.tsx`, `src/routes/dashboard.apps.$appSlug.tsx`             | Mount `WakeDrawer`                                                | 4    |
| `src/routes/-dashboard.debug.test.tsx`                                                 | Debugger drawer tests                                             | 4    |
| `src/components/dashboard/app-insights.tsx`, its test                                  | Recent-wakes rows open a wake                                     | 5    |
| `src/components/dashboard/account-analytics.tsx`, `src/routes/dashboard.analytics.tsx` | Analytics hosts the drawer                                        | 5    |
| `src/routes/-dashboard.analytics-wake.test.ts` (new)                                   | Analytics `wake` param test                                       | 5    |
| `mock/plugin.ts`                                                                       | Canonical wake scenarios, 402 on Free, `wake_id` on cold requests | 6    |

---

### Task 1: The wake-anatomy parser

**Files:**

- Create: `src/lib/wake-anatomy.ts`
- Create: `src/test/wake-frames.ts`
- Test: `src/lib/wake-anatomy.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces, all exported from `src/lib/wake-anatomy.ts`:
  - `type RawWakeEvent = { at: string; kind: string; actor?: string; data?: Record<string, unknown> | null }`
  - `type WakeMethod = 'restore' | 'cold_boot' | 'thaw' | 'unknown'`
  - `interface WakeSegment { key: string; label: string; startMs: number; endMs: number; actor: string }`
  - `interface WakePhase { key: string; label: string; ms: number; share: number }`
  - `type ArtifactSource = 'backend_local' | 'cache_hit' | 'materialized' | 'direct' | 'unknown'`
  - `interface WakeArtifact { artifact: string; source: ArtifactSource; durationMs: number; bytes?: number }`
  - `interface WakeBreakdown { kind: 'restore' | 'cold_boot' | 'thaw'; totalMs: number; beforeWindow: WakePhase[]; phases: WakePhase[]; artifacts: WakeArtifact[]; largest?: WakePhase; phaseSumMs: number }`
  - `type WakeOutcome = { status: 'ready' } | { status: 'failed'; reason?: string } | { status: 'stalled'; reason?: string } | { status: 'in_progress' }`
  - `interface WakeFirstByte { latencyMs?: number; proxyLatencyMs?: number; gatewayPhasesMs: Record<string, number> }`
  - `interface WakeGeneration { t0: number; totalMs?: number; method: WakeMethod; segments: WakeSegment[]; breakdownAt?: string; breakdown?: WakeBreakdown; outcome: WakeOutcome; fallback?: 'after_restore_failed'; firstByte?: WakeFirstByte }`
  - `interface WakeAnatomy { generations: WakeGeneration[]; otherFrames: RawWakeEvent[] }`
  - `function parseWake(events: readonly RawWakeEvent[]): WakeAnatomy`
  - `const SOURCE_LABELS: Record<ArtifactSource, string>`
- Produces from `src/test/wake-frames.ts`: `T0`, `at(ms)`, `frame(ms, kind, actor, data?)`, `RESTORE_BREAKDOWN`, `restoreFrames(offset?)`, `coldBootFrames`, `thawFrames`, `failedFrames`, `stalledFrames`, `fallbackFrames`.

- [ ] **Step 1: Write the test frames**

Create `src/test/wake-frames.ts`:

```ts
import type { RawWakeEvent } from '@/lib/wake-anatomy';

/** Canonical ADR-064 wake frames for tests. Times are millisecond offsets from T0. */
export const T0 = Date.parse('2026-10-21T10:00:00.000Z');
export const at = (ms: number) => new Date(T0 + ms).toISOString();
export const frame = (
  ms: number,
  kind: string,
  actor: string,
  data: Record<string, unknown> = {}
): RawWakeEvent => ({ at: at(ms), kind, actor, data });

/** Phases add up to 263 ms against a 302 ms total: they overlap, as real restores do. */
export const RESTORE_BREAKDOWN = {
  lease_acquire_ms: 2,
  env_prepare_ms: 1,
  pre_network_ms: 0,
  setup_network_ms: 3,
  restore_gate_wait_ms: 0,
  chroot_ms: 4,
  materialize_mem_ms: 12,
  materialize_vmstate_ms: 2,
  resolve_images_ms: 6,
  stage_drives_ms: 9,
  stage_pre_boot_files_ms: 7,
  stage_snapshot_ms: 3,
  helper_ms: 5,
  start_jailer_ms: 11,
  bind_tun_ms: 8,
  load_snapshot_ms: 142,
  resume_hook_ms: 14,
  wait_ready_ms: 40,
  total_ms: 302,
  resolve_artifacts: [
    { artifact: 'kernel', source: 'cache_hit', duration_ms: 1, bytes: 12_000_000 },
    { artifact: 'main', source: 'materialized', duration_ms: 5, bytes: 480_000_000 },
  ],
};

export const restoreFrames = (offset = 0): RawWakeEvent[] => [
  frame(offset + 0, 'wake.queue_accepted', 'schedd', { queue_wait_ms: 0 }),
  frame(offset + 4, 'wake.admitted', 'schedd'),
  frame(offset + 9, 'wake.boot_started', 'schedd', { method: 'restore' }),
  frame(offset + 281, 'wake.restore_breakdown', 'vmmd', RESTORE_BREAKDOWN),
  frame(offset + 282, 'wake.readiness_200', 'vmmd', { probe_count: 2, elapsed_ms: 40 }),
  frame(offset + 290, 'wake.boot_completed', 'schedd', { method: 'restore' }),
  frame(offset + 311, 'wake.proxy_first_byte', 'gatewayd', {
    latency_ms: 311,
    proxy_latency_ms: 3,
    gateway_phases_ms: { route: 1, wake_wait: 300 },
  }),
];

/** Phases add up exactly to the total, so no overlap note. */
export const coldBootFrames: RawWakeEvent[] = [
  frame(0, 'wake.admitted', 'schedd'),
  frame(2, 'wake.boot_started', 'schedd', { method: 'cold_boot' }),
  frame(900, 'wake.cold_boot_breakdown', 'vmmd', {
    resolve_images_ms: 120,
    chroot_ms: 5,
    provision_ms: 40,
    stage_runtime_ms: 30,
    prepare_config_ms: 4,
    helper_ms: 6,
    start_jailer_ms: 12,
    bind_tun_ms: 9,
    cgroup_ms: 3,
    write_config_ms: 2,
    wait_ready_ms: 640,
    quota_restore_ms: 1,
    total_ms: 872,
    resolve_artifacts: [{ artifact: 'base', source: 'direct', duration_ms: 120, bytes: 0 }],
  }),
  frame(901, 'wake.readiness_200', 'vmmd', { probe_count: 9, elapsed_ms: 640 }),
  frame(910, 'wake.boot_completed', 'schedd', { method: 'cold_boot' }),
];

const thaw = (ms: number): RawWakeEvent[] => [
  frame(ms, 'wake.thaw_breakdown', 'schedd', {
    wake_reads_ms: 1,
    thaw_reads_ms: 2,
    vmmd_thaw_ms: 20,
    publish_ms: 1,
    after_publish_ms: 2,
    total_ms: 26,
  }),
  frame(ms + 30, 'wake.proxy_first_byte', 'gatewayd', { latency_ms: 30 }),
];

/** A first boot, then two thaws that share its wake ID. */
export const thawFrames: RawWakeEvent[] = [...restoreFrames(), ...thaw(60_000), ...thaw(120_000)];

export const failedFrames: RawWakeEvent[] = [
  frame(0, 'wake.admitted', 'schedd'),
  frame(3, 'wake.boot_started', 'schedd', { method: 'restore' }),
  frame(700, 'wake.boot_failed', 'schedd', { reason: 'oom_killed' }),
];

export const stalledFrames: RawWakeEvent[] = [
  frame(0, 'wake.admitted', 'schedd'),
  frame(3, 'wake.boot_started', 'schedd', { method: 'restore' }),
  frame(30_000, 'wake.stalled', 'schedd', { reason: 'watchdog_timeout' }),
];

export const fallbackFrames: RawWakeEvent[] = restoreFrames().map((f) =>
  f.kind === 'wake.boot_completed'
    ? { ...f, data: { method: 'cold_boot', restore_fallback_reason: 'after_restore_failed' } }
    : f
);
```

- [ ] **Step 2: Write the failing parser tests**

Create `src/lib/wake-anatomy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseWake, type RawWakeEvent } from './wake-anatomy';
import {
  at,
  coldBootFrames,
  failedFrames,
  fallbackFrames,
  frame,
  restoreFrames,
  stalledFrames,
  thawFrames,
} from '@/test/wake-frames';

describe('parseWake', () => {
  it('reads a restore: milestones on a real axis, ordered by time', () => {
    const { generations, otherFrames } = parseWake(restoreFrames());
    expect(otherFrames).toEqual([]);
    expect(generations).toHaveLength(1);
    const g = generations[0];
    expect(g.method).toBe('restore');
    expect(g.outcome).toEqual({ status: 'ready' });
    expect(g.totalMs).toBe(311);
    // readiness_200 (vmmd) lands before boot_completed (schedd): order is by time.
    expect(g.segments.map((s) => [s.label, s.startMs, s.endMs, s.actor])).toEqual([
      ['Until admitted', 0, 4, 'schedd'],
      ['Until boot started', 4, 9, 'schedd'],
      ['Until ready', 9, 282, 'vmmd'],
      ['Until boot recorded', 282, 290, 'schedd'],
      ['Until first byte', 290, 311, 'gatewayd'],
    ]);
    expect(g.breakdownAt).toBe('wake.readiness_200');
    expect(g.firstByte).toEqual({
      latencyMs: 311,
      proxyLatencyMs: 3,
      gatewayPhasesMs: { route: 1, wake_wait: 300 },
    });
  });

  it('attributes restore phases by share of the total and keeps pre-window phases apart', () => {
    const b = parseWake(restoreFrames()).generations[0].breakdown!;
    expect(b.kind).toBe('restore');
    expect(b.totalMs).toBe(302);
    expect(b.beforeWindow.map((p) => p.key)).toEqual([
      'lease_acquire_ms',
      'env_prepare_ms',
      'pre_network_ms',
      'setup_network_ms',
    ]);
    expect(b.phases[0]).toEqual({
      key: 'restore_gate_wait_ms',
      label: 'Wait for restore slot',
      ms: 0,
      share: 0,
    });
    expect(b.largest).toMatchObject({ key: 'load_snapshot_ms', label: 'Load snapshot', ms: 142 });
    expect(b.largest!.share).toBeCloseTo(142 / 302);
    expect(b.phaseSumMs).toBe(263);
    expect(b.artifacts).toEqual([
      { artifact: 'kernel', source: 'cache_hit', durationMs: 1, bytes: 12_000_000 },
      { artifact: 'main', source: 'materialized', durationMs: 5, bytes: 480_000_000 },
    ]);
  });

  it('never names a pre-window phase as the largest', () => {
    const frames = restoreFrames().map((f) =>
      f.kind === 'wake.restore_breakdown' ? { ...f, data: { ...f.data, setup_network_ms: 900 } } : f
    );
    expect(parseWake(frames).generations[0].breakdown!.largest?.key).toBe('load_snapshot_ms');
  });

  it('draws a leading Queued segment from queue_wait_ms', () => {
    const frames = restoreFrames().map((f) =>
      f.kind === 'wake.queue_accepted' ? { ...f, data: { queue_wait_ms: 15 } } : f
    );
    const g = parseWake(frames).generations[0];
    expect(g.segments[0]).toMatchObject({ label: 'Queued', startMs: 0, endMs: 15 });
    expect(g.segments[1]).toMatchObject({ label: 'Until admitted', startMs: 15, endMs: 19 });
  });

  it('reads a cold boot and drops a zero byte size', () => {
    const g = parseWake(coldBootFrames).generations[0];
    expect(g.method).toBe('cold_boot');
    expect(g.breakdown).toMatchObject({ kind: 'cold_boot', totalMs: 872, phaseSumMs: 872 });
    expect(g.breakdown!.beforeWindow).toEqual([]);
    expect(g.breakdown!.largest?.key).toBe('wait_ready_ms');
    expect(g.breakdown!.artifacts).toEqual([
      { artifact: 'base', source: 'direct', durationMs: 120 },
    ]);
    expect(g.totalMs).toBe(910);
  });

  it('splits thaws into generations after each first byte', () => {
    const gens = parseWake(thawFrames).generations;
    expect(gens.map((g) => g.method)).toEqual(['restore', 'thaw', 'thaw']);
    expect(gens[2].breakdown).toMatchObject({ kind: 'thaw', totalMs: 26, phaseSumMs: 26 });
    expect(gens[2].segments).toEqual([
      {
        key: 'wake.proxy_first_byte',
        label: 'Until first byte',
        startMs: 0,
        endMs: 30,
        actor: 'gatewayd',
      },
    ]);
    expect(gens[2].breakdownAt).toBe('wake.proxy_first_byte');
    expect(gens[2].totalMs).toBe(30);
  });

  it('keeps frames after the last first byte as an in-progress generation', () => {
    const gens = parseWake([
      ...restoreFrames(),
      frame(60_000, 'wake.admitted', 'schedd'),
    ]).generations;
    expect(gens).toHaveLength(2);
    expect(gens[1].outcome).toEqual({ status: 'in_progress' });
    expect(gens[1].totalMs).toBeUndefined();
  });

  it.each([
    ['failed', failedFrames, { status: 'failed', reason: 'oom_killed' }],
    ['stalled', stalledFrames, { status: 'stalled', reason: 'watchdog_timeout' }],
  ])('reports a %s wake with its reason', (_name, frames, outcome) => {
    expect(parseWake(frames).generations[0].outcome).toEqual(outcome);
  });

  it('notes a restore that fell back to a cold boot', () => {
    const g = parseWake(fallbackFrames).generations[0];
    expect(g.fallback).toBe('after_restore_failed');
    expect(g.method).toBe('cold_boot');
    expect(g.outcome).toEqual({ status: 'ready' });
  });

  it('drops malformed numbers and unknown artifact sources instead of drawing them', () => {
    const b = parseWake([
      {
        at: at(100),
        kind: 'wake.restore_breakdown',
        actor: 'vmmd',
        data: {
          load_snapshot_ms: '142',
          resume_hook_ms: -3,
          wait_ready_ms: Number.NaN,
          chroot_ms: 4,
          total_ms: 'soon',
          resolve_artifacts: [
            { artifact: 'main', source: 'teleported', duration_ms: 5 },
            { artifact: 'x' },
            'junk',
          ],
        },
      },
    ]).generations[0].breakdown!;
    expect(b.phases.map((p) => p.key)).toEqual(['chroot_ms']);
    expect(b.totalMs).toBe(0);
    expect(b.phases[0].share).toBe(0);
    expect(b.artifacts).toEqual([{ artifact: 'main', source: 'unknown', durationMs: 5 }]);
  });

  it('tolerates frames with no data at all', () => {
    const frames: RawWakeEvent[] = [
      { at: at(0), kind: 'wake.boot_started', actor: 'schedd' },
      { at: at(250), kind: 'wake.boot_completed', data: null },
    ];
    const g = parseWake(frames).generations[0];
    expect(g.method).toBe('unknown');
    expect(g.totalMs).toBe(250);
    expect(g.segments).toEqual([
      {
        key: 'wake.boot_completed',
        label: 'Until boot recorded',
        startMs: 0,
        endMs: 250,
        actor: '',
      },
    ]);
  });

  it('keeps unknown, legacy, unused and undated frames in otherFrames, unchanged', () => {
    const odd: RawWakeEvent[] = [
      frame(1, 'state_transition', 'schedd'),
      frame(2, 'wake.cold_boot_cpu', 'vmmd'),
      { at: 'not a time', kind: 'wake.admitted', actor: 'schedd', data: {} },
    ];
    expect(parseWake([...restoreFrames(), ...odd]).otherFrames).toEqual(odd);
  });

  it('returns nothing for an empty timeline', () => {
    expect(parseWake([])).toEqual({ generations: [], otherFrames: [] });
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

```bash
npx vitest run --maxWorkers=8 src/lib/wake-anatomy.test.ts
```

Expected: FAIL, because `./wake-anatomy` does not exist (an import resolution error for every test).

- [ ] **Step 4: Write the parser**

Create `src/lib/wake-anatomy.ts`:

```ts
/**
 * One wake, read from its canonical `wake.*` frames (ADR-064).
 *
 * Milestones carry real timestamps and become segments on a time axis.
 * Breakdown events carry durations, not positions: restore phases overlap
 * (vmmd writes pre-boot files and sets up the network concurrently), so they
 * are attributed as shares of `total_ms` and never laid end to end.
 * This module is the only code that knows the vocabulary.
 */

export type RawWakeEvent = {
  at: string;
  kind: string;
  actor?: string;
  data?: Record<string, unknown> | null;
};

export type WakeMethod = 'restore' | 'cold_boot' | 'thaw' | 'unknown';

export interface WakeSegment {
  key: string;
  label: string;
  startMs: number;
  endMs: number;
  actor: string;
}

export interface WakePhase {
  key: string;
  label: string;
  ms: number;
  share: number;
}

export type ArtifactSource = 'backend_local' | 'cache_hit' | 'materialized' | 'direct' | 'unknown';

export interface WakeArtifact {
  artifact: string;
  source: ArtifactSource;
  durationMs: number;
  bytes?: number;
}

export interface WakeBreakdown {
  kind: 'restore' | 'cold_boot' | 'thaw';
  totalMs: number;
  beforeWindow: WakePhase[];
  phases: WakePhase[];
  artifacts: WakeArtifact[];
  largest?: WakePhase;
  phaseSumMs: number;
}

export type WakeOutcome =
  | { status: 'ready' }
  | { status: 'failed'; reason?: string }
  | { status: 'stalled'; reason?: string }
  | { status: 'in_progress' };

export interface WakeFirstByte {
  latencyMs?: number;
  proxyLatencyMs?: number;
  gatewayPhasesMs: Record<string, number>;
}

export interface WakeGeneration {
  t0: number;
  totalMs?: number;
  method: WakeMethod;
  segments: WakeSegment[];
  /** The segment key whose row carries the breakdown disclosure. */
  breakdownAt?: string;
  breakdown?: WakeBreakdown;
  outcome: WakeOutcome;
  fallback?: 'after_restore_failed';
  firstByte?: WakeFirstByte;
}

export interface WakeAnatomy {
  generations: WakeGeneration[];
  otherFrames: RawWakeEvent[];
}

const MILESTONE_LABELS: Record<string, string> = {
  'wake.queue_accepted': 'Queued',
  'wake.admitted': 'Until admitted',
  'wake.boot_started': 'Until boot started',
  'wake.readiness_200': 'Until ready',
  'wake.boot_completed': 'Until boot recorded',
  'wake.proxy_first_byte': 'Until first byte',
  'wake.boot_failed': 'Until boot failed',
  'wake.stalled': 'Until stalled',
};

const BREAKDOWN_KINDS: Record<string, WakeBreakdown['kind']> = {
  'wake.restore_breakdown': 'restore',
  'wake.cold_boot_breakdown': 'cold_boot',
  'wake.thaw_breakdown': 'thaw',
};

/** Manager.Wake phases that run before the restore window; outside `total_ms` (ADR-192). */
const RESTORE_BEFORE = ['lease_acquire_ms', 'env_prepare_ms', 'pre_network_ms', 'setup_network_ms'];

const PHASE_KEYS: Record<WakeBreakdown['kind'], string[]> = {
  restore: [
    'restore_gate_wait_ms',
    'chroot_ms',
    'materialize_mem_ms',
    'materialize_vmstate_ms',
    'resolve_images_ms',
    'stage_drives_ms',
    'stage_pre_boot_files_ms',
    'stage_snapshot_ms',
    'helper_ms',
    'start_jailer_ms',
    'bind_tun_ms',
    'load_snapshot_ms',
    'resume_hook_ms',
    'wait_ready_ms',
  ],
  cold_boot: [
    'resolve_images_ms',
    'chroot_ms',
    'provision_ms',
    'stage_runtime_ms',
    'prepare_config_ms',
    'helper_ms',
    'start_jailer_ms',
    'bind_tun_ms',
    'cgroup_ms',
    'write_config_ms',
    'wait_ready_ms',
    'quota_restore_ms',
  ],
  thaw: ['wake_reads_ms', 'thaw_reads_ms', 'vmmd_thaw_ms', 'publish_ms', 'after_publish_ms'],
};

const PHASE_LABELS: Record<string, string> = {
  lease_acquire_ms: 'Acquire lease',
  env_prepare_ms: 'Prepare environment',
  pre_network_ms: 'Before network',
  setup_network_ms: 'Set up network',
  restore_gate_wait_ms: 'Wait for restore slot',
  chroot_ms: 'Create chroot',
  materialize_mem_ms: 'Materialise memory',
  materialize_vmstate_ms: 'Materialise VM state',
  resolve_images_ms: 'Resolve images',
  stage_drives_ms: 'Stage drives',
  stage_pre_boot_files_ms: 'Write pre-boot files',
  stage_snapshot_ms: 'Stage snapshot',
  helper_ms: 'Run helper',
  start_jailer_ms: 'Start jailer',
  bind_tun_ms: 'Bind network device',
  load_snapshot_ms: 'Load snapshot',
  resume_hook_ms: 'Resume hooks',
  wait_ready_ms: 'Wait for ready',
  provision_ms: 'Provision',
  stage_runtime_ms: 'Stage runtime',
  prepare_config_ms: 'Prepare config',
  cgroup_ms: 'Set up cgroup',
  write_config_ms: 'Write config',
  quota_restore_ms: 'Restore CPU quota',
  wake_reads_ms: 'Read wake state',
  thaw_reads_ms: 'Read thaw state',
  vmmd_thaw_ms: 'Thaw VM',
  publish_ms: 'Publish',
  after_publish_ms: 'After publish',
};

export const SOURCE_LABELS: Record<ArtifactSource, string> = {
  backend_local: 'Local',
  cache_hit: 'Cache hit',
  materialized: 'Fetched',
  direct: 'Direct',
  unknown: 'Unknown',
};

const SOURCES: ArtifactSource[] = ['backend_local', 'cache_hit', 'materialized', 'direct'];

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

type Item = { ev: RawWakeEvent; t: number; data: Record<string, unknown> };

function phasesFrom(keys: string[], data: Record<string, unknown>, total: number): WakePhase[] {
  return keys.flatMap((key) => {
    const ms = num(data[key]);
    if (ms === undefined) return [];
    return [{ key, label: PHASE_LABELS[key] ?? key, ms, share: total > 0 ? ms / total : 0 }];
  });
}

function readArtifacts(raw: unknown): WakeArtifact[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): WakeArtifact[] => {
    if (!item || typeof item !== 'object') return [];
    const r = item as Record<string, unknown>;
    const artifact = str(r.artifact);
    const durationMs = num(r.duration_ms);
    if (!artifact || durationMs === undefined) return [];
    const source = SOURCES.find((s) => s === r.source) ?? 'unknown';
    // Zero means vmmd's stat failed; a size we do not know is left out.
    const bytes = num(r.bytes);
    return [{ artifact, source, durationMs, ...(bytes ? { bytes } : {}) }];
  });
}

function readBreakdown(kind: WakeBreakdown['kind'], data: Record<string, unknown>): WakeBreakdown {
  const totalMs = num(data.total_ms) ?? 0;
  const phases = phasesFrom(PHASE_KEYS[kind], data, totalMs);
  const beforeWindow = kind === 'restore' ? phasesFrom(RESTORE_BEFORE, data, totalMs) : [];
  const top = phases.reduce<WakePhase | undefined>(
    (best, p) => (!best || p.ms > best.ms ? p : best),
    undefined
  );
  return {
    kind,
    totalMs,
    beforeWindow,
    phases,
    artifacts: readArtifacts(data.resolve_artifacts),
    ...(top && top.ms > 0 ? { largest: top } : {}),
    phaseSumMs: phases.reduce((sum, p) => sum + p.ms, 0),
  };
}

function readPhaseMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).flatMap(([k, v]) => {
      const ms = num(v);
      return ms === undefined ? [] : [[k, ms]];
    })
  );
}

function buildGeneration(group: Item[]): WakeGeneration {
  const find = (kind: string) => group.find((i) => i.ev.kind === kind);
  const milestones = group.filter((i) => i.ev.kind in MILESTONE_LABELS);
  const queue = find('wake.queue_accepted');
  const queueWait = queue ? (num(queue.data.queue_wait_ms) ?? 0) : 0;
  const first = group[0].t;
  const t0 = queue && queueWait > 0 ? Math.min(first, queue.t - queueWait) : first;

  const segments: WakeSegment[] = [];
  let prev = t0;
  for (const m of milestones) {
    // The first milestone at t0 opens the axis; it closes no segment.
    if (segments.length === 0 && m.t === t0) {
      prev = m.t;
      continue;
    }
    segments.push({
      key: m.ev.kind,
      label: MILESTONE_LABELS[m.ev.kind],
      startMs: prev - t0,
      endMs: m.t - t0,
      actor: m.ev.actor ?? '',
    });
    prev = m.t;
  }

  const bdItem = group.find((i) => i.ev.kind in BREAKDOWN_KINDS);
  const breakdown = bdItem
    ? readBreakdown(BREAKDOWN_KINDS[bdItem.ev.kind], bdItem.data)
    : undefined;

  const completed = find('wake.boot_completed');
  const started = find('wake.boot_started');
  const failed = find('wake.boot_failed');
  const stalled = find('wake.stalled');
  const firstByteItem = find('wake.proxy_first_byte');

  const rawMethod = str(completed?.data.method) ?? str(started?.data.method);
  const method: WakeMethod =
    rawMethod === 'restore' || rawMethod === 'cold_boot' || rawMethod === 'thaw'
      ? rawMethod
      : (breakdown?.kind ?? 'unknown');

  let outcome: WakeOutcome;
  if (failed) {
    const reason = str(failed.data.reason);
    outcome = reason ? { status: 'failed', reason } : { status: 'failed' };
  } else if (stalled && !(completed && completed.t > stalled.t)) {
    const reason = str(stalled.data.reason);
    outcome = reason ? { status: 'stalled', reason } : { status: 'stalled' };
  } else if (completed || firstByteItem) {
    outcome = { status: 'ready' };
  } else {
    outcome = { status: 'in_progress' };
  }

  const firstByte = firstByteItem
    ? {
        ...(num(firstByteItem.data.latency_ms) !== undefined
          ? { latencyMs: num(firstByteItem.data.latency_ms) }
          : {}),
        ...(num(firstByteItem.data.proxy_latency_ms) !== undefined
          ? { proxyLatencyMs: num(firstByteItem.data.proxy_latency_ms) }
          : {}),
        gatewayPhasesMs: readPhaseMap(firstByteItem.data.gateway_phases_ms),
      }
    : undefined;

  const lastEnd = segments.length ? segments[segments.length - 1].endMs : undefined;
  const totalMs = firstByte?.latencyMs ?? (outcome.status === 'in_progress' ? undefined : lastEnd);

  const breakdownAt = segments.some((s) => s.key === 'wake.readiness_200')
    ? 'wake.readiness_200'
    : segments.some((s) => s.key === 'wake.boot_completed')
      ? 'wake.boot_completed'
      : segments.length
        ? segments[segments.length - 1].key
        : undefined;

  return {
    t0,
    ...(totalMs !== undefined ? { totalMs } : {}),
    method,
    segments,
    ...(breakdownAt ? { breakdownAt } : {}),
    ...(breakdown ? { breakdown } : {}),
    outcome,
    ...(completed?.data.restore_fallback_reason === 'after_restore_failed'
      ? { fallback: 'after_restore_failed' as const }
      : {}),
    ...(firstByte ? { firstByte } : {}),
  };
}

export function parseWake(events: readonly RawWakeEvent[]): WakeAnatomy {
  const consumed: Item[] = [];
  const otherFrames: RawWakeEvent[] = [];
  for (const ev of events) {
    const t = Date.parse(ev.at);
    const known = ev.kind in MILESTONE_LABELS || ev.kind in BREAKDOWN_KINDS;
    if (known && Number.isFinite(t)) consumed.push({ ev, t, data: ev.data ?? {} });
    else otherFrames.push(ev);
  }
  consumed.sort((a, b) => a.t - b.t);

  // A frozen VM keeps one wake ID across thaws, and each thaw ends with its
  // own first byte, so the timeline splits after every first byte.
  const groups: Item[][] = [];
  let current: Item[] = [];
  for (const item of consumed) {
    current.push(item);
    if (item.ev.kind === 'wake.proxy_first_byte') {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);

  return { generations: groups.map(buildGeneration), otherFrames };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
npx vitest run --maxWorkers=8 src/lib/wake-anatomy.test.ts
```

Expected: PASS, every test, exit code 0, no "Errors" line.

- [ ] **Step 6: Typecheck and format the new files**

```bash
npx tsc --noEmit && npx prettier --write src/lib/wake-anatomy.ts src/lib/wake-anatomy.test.ts src/test/wake-frames.ts
```

Expected: tsc exits 0. Prettier may rewrap lines; rerun the Step 5 command afterwards and expect PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/wake-anatomy.ts src/lib/wake-anatomy.test.ts src/test/wake-frames.ts
git commit -m "feat(console): read a wake's canonical frames into stages and phases

The wake timeline returns typed wake.* frames (ADR-064), but the console
printed them as a flat list. This parser turns them into generations: real
milestone segments for a time axis, and a breakdown of restore, cold-boot or
thaw phases as shares of their total. Restore phases overlap, so they are
never laid end to end. Malformed values are dropped and unknown frames are
kept aside, so nothing is invented and nothing is lost."
```

---

### Task 2: The `WakeWaterfall` view and its data hook

**Files:**

- Modify: `src/lib/api/queries.ts` (`useWakeTimeline`, around line 601)
- Create: `src/components/dashboard/wake-waterfall.tsx`
- Test: `src/components/dashboard/wake-waterfall.test.tsx`
- Modify: `src/components/dashboard/instance-detail.tsx` (import on line 6, render around line 166)
- Delete: `src/components/dashboard/wake-timeline.tsx`

**Interfaces:**

- Consumes from Task 1: `parseWake`, `RawWakeEvent`, `WakeGeneration`, `WakeBreakdown`, `WakePhase`, `WakeArtifact`, `WakeFirstByte`, `SOURCE_LABELS`; test frames from `src/test/wake-frames.ts`.
- Produces:
  - `useWakeTimeline(slug: string, wakeId: string)` returns a TanStack infinite query whose `data.pages` are `WakeTimelineResponse` objects. Query key unchanged: `['apps', slug, 'wakes', wakeId]`.
  - `export function WakeWaterfall({ slug, wakeId }: { slug: string; wakeId: string })`.

- [ ] **Step 1: Write the failing component tests**

Create `src/components/dashboard/wake-waterfall.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { withRouter } from '@/test/router';
import type { RawWakeEvent } from '@/lib/wake-anatomy';
import {
  coldBootFrames,
  failedFrames,
  fallbackFrames,
  frame,
  restoreFrames,
  stalledFrames,
  thawFrames,
} from '@/test/wake-frames';
import { WakeWaterfall } from './wake-waterfall';

const { useWakeTimeline } = vi.hoisted(() => ({ useWakeTimeline: vi.fn() }));
vi.mock('@/lib/api/queries', () => ({ useWakeTimeline }));

const fetchNextPage = vi.fn();
function pages(list: RawWakeEvent[][], hasNextPage = false) {
  return {
    data: {
      pages: list.map((events) => ({
        wake_id: 'wk-1',
        app_id: 'app-1',
        events,
        next_cursor: '',
        limit: 1000,
      })),
    },
    isPending: false,
    error: null,
    refetch: vi.fn(),
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage: false,
  };
}
const show = (events: RawWakeEvent[]) => useWakeTimeline.mockReturnValue(pages([events]));
const summary = () => screen.getByRole('region', { name: 'Wake summary' });

beforeEach(() => {
  useWakeTimeline.mockReset();
  fetchNextPage.mockReset();
});

describe('WakeWaterfall', () => {
  it('leads with the total, the method, the outcome and where the time went', () => {
    show(restoreFrames());
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    expect(within(summary()).getByText('311 ms')).toBeInTheDocument();
    expect(within(summary()).getByText('Restore')).toBeInTheDocument();
    expect(within(summary()).getByText('Ready')).toBeInTheDocument();
    expect(summary()).toHaveTextContent('Most of the restore: Load snapshot, 142 ms (47%).');
    expect(
      within(summary()).getByRole('button', { name: 'Copy: wake ID wk-1' })
    ).toBeInTheDocument();
  });

  it('lays milestones on a time axis and opens the breakdown under the ready row', async () => {
    show(restoreFrames());
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    const stages = screen.getByRole('table', { name: 'Stages' });
    for (const label of [
      'Until admitted',
      'Until boot started',
      'Until boot recorded',
      'Until first byte',
    ])
      expect(within(stages).getByText(label)).toBeInTheDocument();
    const host = within(stages).getByRole('button', { name: 'Until ready' });
    expect(host).toHaveAttribute('aria-expanded', 'true');
    const phases = screen.getByRole('table', { name: 'Restore phases, 302 ms total' });
    expect(within(phases).getByText('Load snapshot')).toBeInTheDocument();
    expect(within(phases).getByText('load_snapshot_ms')).toBeInTheDocument();
    expect(within(phases).getByText('Fetched')).toBeInTheDocument();
    expect(within(phases).getByText('Cache hit')).toBeInTheDocument();
    expect(within(phases).getByText('458 MiB')).toBeInTheDocument();
    expect(
      within(screen.getByRole('table', { name: 'Before restore (not in the total)' })).getByText(
        'Set up network'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Phases can overlap. Their durations add up to 263 ms against a total of 302 ms.'
      )
    ).toBeInTheDocument();
    await userEvent.click(host);
    expect(host).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('table', { name: 'Restore phases, 302 ms total' })
    ).not.toBeInTheDocument();
  });

  it('shows the gateway timings for the first byte', () => {
    show(restoreFrames());
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    const firstByte = screen.getByRole('region', { name: 'First byte' });
    expect(within(firstByte).getByText('wake_wait')).toBeInTheDocument();
    expect(within(firstByte).getByText('300 ms')).toBeInTheDocument();
  });

  it('says nothing about overlap when the phases add up to the total', () => {
    show(coldBootFrames);
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    expect(
      screen.getByRole('table', { name: 'Cold boot phases, 872 ms total' })
    ).toBeInTheDocument();
    expect(screen.queryByText(/Phases can overlap/)).not.toBeInTheDocument();
  });

  it.each([
    [failedFrames, 'The boot failed (oom_killed).'],
    [stalledFrames, 'The wake stalled (watchdog_timeout).'],
    [
      fallbackFrames,
      'The restore fell back to a cold boot because the app’s after-restore callback failed (after_restore_failed).',
    ],
  ])('puts a failure, stall or fallback first', (frames, text) => {
    show(frames);
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    expect(within(summary()).getByRole('status')).toHaveTextContent(text);
    expect(summary()).not.toHaveTextContent('Most of the');
  });

  it('offers a thaw picker only when the wake has more than one generation', async () => {
    show(thawFrames);
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    const picker = screen.getByRole('combobox', { name: 'Wake generation' });
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['First boot', 'Thaw 1', 'Thaw 2']);
    expect(within(summary()).getByText('Thaw')).toBeInTheDocument();
    await userEvent.selectOptions(picker, 'First boot');
    expect(within(summary()).getByText('Restore')).toBeInTheDocument();
  });

  it('has no picker for a single generation', () => {
    show(restoreFrames());
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    expect(screen.queryByRole('combobox', { name: 'Wake generation' })).not.toBeInTheDocument();
  });

  it('keeps unknown frames under Other frames, opened when there are no stages', () => {
    show([frame(0, 'wake.queued', 'schedd'), frame(125, 'vm.ready', 'vmmd')]);
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    const other = screen.getByText('Other frames (2)').closest('details')!;
    expect(other).toHaveAttribute('open');
    expect(within(other).getByText('vm.ready')).toBeInTheDocument();
    expect(within(other).getByText('+125 ms')).toBeInTheDocument();
  });

  it('never prints NaN when a breakdown has no total', () => {
    show([frame(0, 'wake.restore_breakdown', 'vmmd', { load_snapshot_ms: 10 })]);
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Phases can overlap/)).not.toBeInTheDocument();
  });

  it('counts a frame repeated across pages once and loads later frames on request', async () => {
    const boundary = frame(0, 'state_transition', 'schedd');
    useWakeTimeline.mockReturnValue(
      pages([[boundary], [boundary, frame(5, 'park_snapshot_error', 'schedd')]], true)
    );
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    expect(screen.getByText('Other frames (2)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load later frames' }));
    expect(fetchNextPage).toHaveBeenCalledOnce();
  });

  it('shows the empty state for a wake with no frames', () => {
    show([]);
    render(<WakeWaterfall slug="api" wakeId="wk-1" />);
    expect(screen.getByText(/No frames recorded for this wake/)).toBeInTheDocument();
  });

  it('treats an unknown or expired wake (not_found) as empty, not as an error', () => {
    useWakeTimeline.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({
        status: 404,
        code: 'not_found',
        title: 'Wake not found',
        detail: 'no events row with that wake_id belongs to this account',
      }),
      refetch: vi.fn(),
      hasNextPage: false,
      fetchNextPage,
      isFetchingNextPage: false,
    });
    render(<WakeWaterfall slug="api" wakeId="wk-gone" />);
    expect(screen.getByText(/No frames recorded for this wake/)).toBeInTheDocument();
    expect(screen.queryByText(/no events row/)).not.toBeInTheDocument();
  });

  it('renders the Free-plan 402 as the plan panel', () => {
    useWakeTimeline.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({
        status: 402,
        code: 'plan_per_app_metrics_not_allowed',
        title: 'Not on your plan',
        detail: 'the free plan does not include per-app metrics; upgrade to Hobby or above.',
      }),
      refetch: vi.fn(),
      hasNextPage: false,
      fetchNextPage,
      isFetchingNextPage: false,
    });
    render(withRouter(<WakeWaterfall slug="api" wakeId="wk-1" />));
    expect(screen.getByText(/Wake timeline/)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Stages' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx vitest run --maxWorkers=8 src/components/dashboard/wake-waterfall.test.tsx
```

Expected: FAIL, because `./wake-waterfall` does not exist.

- [ ] **Step 3: Turn `useWakeTimeline` into an infinite query**

In `src/lib/api/queries.ts`, replace the whole `useWakeTimeline` function and its doc comment (`/** Frame-by-frame anatomy of one wake attempt. */` through its closing `}`) with:

```ts
/**
 * Frame-by-frame anatomy of one wake attempt, oldest first. The endpoint has
 * no cursor parameter: `next_cursor` is an RFC 3339 timestamp passed back as
 * `since`, so later pages hold later frames. `since` is inclusive, so the
 * boundary frame repeats; callers de-duplicate.
 */
export function useWakeTimeline(slug: string, wakeId: string) {
  return useInfiniteQuery({
    queryKey: ['apps', slug, 'wakes', wakeId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/wakes/{wake_id}/timeline', {
          params: {
            path: { slug, wake_id: wakeId },
            query: { limit: 1000, ...(pageParam ? { since: pageParam } : {}) },
          },
        })
      ),
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: Boolean(slug && wakeId),
  });
}
```

`useInfiniteQuery` is already imported at the top of the file.

- [ ] **Step 4: Write `WakeWaterfall`**

Create `src/components/dashboard/wake-waterfall.tsx`:

```tsx
import { Fragment, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { CopyIconButton } from '@/components/ui/copy-button';
import { FIELD } from '@/components/ui/field';
import { ApiError } from '@/lib/api/errors';
import { useWakeTimeline } from '@/lib/api/queries';
import { formatUsageBytes } from '@/lib/usage-format';
import { cn } from '@/lib/utils';
import {
  parseWake,
  SOURCE_LABELS,
  type RawWakeEvent,
  type WakeArtifact,
  type WakeBreakdown,
  type WakeFirstByte,
  type WakeGeneration,
  type WakePhase,
} from '@/lib/wake-anatomy';
import { EASE } from './motion';
import { PlanGated } from './plan-gated';
import { InlinePhase, queryPhase } from './primitives';
import { Pill } from './resource-table';

const METHOD_LABEL: Record<WakeGeneration['method'], string> = {
  restore: 'Restore',
  cold_boot: 'Cold boot',
  thaw: 'Thaw',
  unknown: 'Unknown method',
};
const OUTCOME: Record<WakeGeneration['outcome']['status'], [string, string]> = {
  ready: ['Ready', 'var(--status-good)'],
  failed: ['Failed', 'var(--status-serious)'],
  stalled: ['Stalled', 'var(--status-warning)'],
  in_progress: ['In progress', 'var(--status-idle)'],
};
const PHASE_TITLE: Record<WakeBreakdown['kind'], string> = {
  restore: 'Restore phases',
  cold_boot: 'Cold boot phases',
  thaw: 'Thaw phases',
};
const KIND_NOUN: Record<WakeBreakdown['kind'], string> = {
  restore: 'restore',
  cold_boot: 'cold boot',
  thaw: 'thaw',
};
const TABULAR = 'font-mono [font-variant-numeric:tabular-nums]';

const frameKey = (e: RawWakeEvent) => `${e.at}|${e.kind}|${e.actor ?? ''}`;

/** Where one wake spent its time: real milestones on an axis, then its phases. */
export function WakeWaterfall({ slug, wakeId }: { slug: string; wakeId: string }) {
  const q = useWakeTimeline(slug, wakeId);
  const events = useMemo(() => {
    const seen = new Set<string>();
    return (q.data?.pages ?? [])
      .flatMap((page) => page.events as RawWakeEvent[])
      .filter((e) => {
        const key = frameKey(e);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [q.data]);
  const anatomy = useMemo(() => parseWake(events), [events]);
  const [picked, setPicked] = useState<number | null>(null);
  // apid answers an unknown or aged-out wake with 404 not_found (it refuses to
  // reveal whether the ID ever existed), which is the empty state, not a fault.
  const gone = q.error instanceof ApiError && q.error.code === 'not_found';
  const phase = gone
    ? 'empty'
    : queryPhase({ error: q.error, loading: q.isPending, isEmpty: events.length === 0 });
  const gens = anatomy.generations;
  const index = picked !== null && picked < gens.length ? picked : gens.length - 1;
  const gen = gens[index];
  const origin = Math.min(...events.map((e) => Date.parse(e.at)).filter((t) => Number.isFinite(t)));

  return (
    <PlanGated error={q.error} feature="Wake timeline">
      <div className="flex flex-col gap-5">
        {phase !== 'ready' ? (
          <InlinePhase
            phase={phase}
            error={gone ? undefined : q.error}
            loadingMessage="Reading the wake…"
            emptyMessage="No frames recorded for this wake. It may have aged out. Check the debugger for request evidence."
            onRetry={() => void q.refetch()}
          />
        ) : (
          <>
            {gens.length > 1 && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Wake generation
                <select
                  className={cn(FIELD, 'w-auto')}
                  value={index}
                  onChange={(e) => setPicked(Number(e.target.value))}
                >
                  {gens.map((_, i) => (
                    <option key={i} value={i}>
                      {i === 0 ? 'First boot' : `Thaw ${i}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {gen ? (
              <>
                <Summary gen={gen} wakeId={wakeId} />
                <Stages gen={gen} />
                {gen.firstByte && <FirstByte firstByte={gen.firstByte} />}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No canonical wake stages were recorded. The raw frames are below.
              </p>
            )}
            <OtherFrames frames={anatomy.otherFrames} origin={origin} open={!gen} />
            {q.hasNextPage && (
              <Button
                size="xs"
                variant="outline"
                busy={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
              >
                Load later frames
              </Button>
            )}
          </>
        )}
      </div>
    </PlanGated>
  );
}

function Summary({ gen, wakeId }: { gen: WakeGeneration; wakeId: string }) {
  const [outcomeLabel, outcomeColor] = OUTCOME[gen.outcome.status];
  return (
    <section aria-label="Wake summary" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className={cn(TABULAR, 'text-3xl font-semibold tracking-tight')}>
          {gen.totalMs !== undefined ? `${gen.totalMs} ms` : '—'}
        </span>
        <Pill label={METHOD_LABEL[gen.method]} />
        <Pill label={outcomeLabel} color={outcomeColor} />
      </div>
      <Headline gen={gen} />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Started {new Date(gen.t0).toLocaleString()}</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono">{wakeId}</span>
        <CopyIconButton text={wakeId} label={`wake ID ${wakeId}`} />
      </div>
    </section>
  );
}

function Headline({ gen }: { gen: WakeGeneration }) {
  const o = gen.outcome;
  if (o.status === 'failed' || o.status === 'stalled' || gen.fallback) {
    const failed = o.status === 'failed';
    const text = failed
      ? 'The boot failed'
      : o.status === 'stalled'
        ? 'The wake stalled'
        : 'The restore fell back to a cold boot because the app’s after-restore callback failed';
    const code = o.status === 'failed' || o.status === 'stalled' ? o.reason : gen.fallback;
    const tone = failed ? 'var(--status-serious)' : 'var(--status-warning)';
    return (
      <p
        role="status"
        className="rounded-md border px-3 py-2 text-sm"
        style={{ borderColor: `color-mix(in oklab, ${tone} 35%, transparent)`, color: tone }}
      >
        {text}
        {code && (
          <>
            {' ('}
            <code className="font-mono text-xs">{code}</code>
            {')'}
          </>
        )}
        .
      </p>
    );
  }
  const bd = gen.breakdown;
  if (bd?.largest && bd.totalMs > 0) {
    return (
      <p className="text-sm">
        Most of the {KIND_NOUN[bd.kind]}: <strong>{bd.largest.label}</strong>, {bd.largest.ms} ms (
        {Math.round(bd.largest.share * 100)}%).
      </p>
    );
  }
  const longest = gen.segments.reduce<WakeGeneration['segments'][number] | undefined>(
    (best, s) => (!best || s.endMs - s.startMs > best.endMs - best.startMs ? s : best),
    undefined
  );
  return longest ? (
    <p className="text-sm">
      Longest stage: <strong>{longest.label}</strong>, {longest.endMs - longest.startMs} ms.
    </p>
  ) : null;
}

function Bar({
  left,
  width,
  tone = 'neutral',
}: {
  left: number;
  width: number;
  tone?: 'brand' | 'neutral' | 'warning';
}) {
  const reduce = useReducedMotion();
  const pct = (v: number) => `${Math.min(100, Math.max(0, v * 100))}%`;
  return (
    <motion.span
      aria-hidden="true"
      className={cn(
        'absolute inset-y-1 min-w-[2px] rounded-sm',
        tone === 'brand' ? 'bg-brand' : 'bg-muted-foreground/40'
      )}
      style={{
        left: pct(left),
        ...(tone === 'warning' ? { backgroundColor: 'var(--status-warning)' } : {}),
      }}
      initial={reduce ? false : { width: 0 }}
      animate={{ width: pct(width) }}
      transition={{ duration: reduce ? 0 : 0.4, ease: EASE }}
    />
  );
}

function Stages({ gen }: { gen: WakeGeneration }) {
  const [open, setOpen] = useState(true);
  const span = Math.max(1, ...gen.segments.map((s) => s.endMs));
  const hosted = Boolean(gen.breakdown && gen.segments.some((s) => s.key === gen.breakdownAt));
  return (
    <>
      {gen.segments.length > 0 && (
        <table className="w-full border-separate border-spacing-y-1 text-xs">
          <caption className="label-mono mb-2 text-left text-muted-foreground">Stages</caption>
          <thead className="sr-only">
            <tr>
              <th>Stage</th>
              <th>Timeline</th>
              <th>Duration</th>
              <th>Recorded by</th>
            </tr>
          </thead>
          <tbody>
            {gen.segments.map((s) => {
              const isHost = hosted && s.key === gen.breakdownAt;
              return (
                <Fragment key={`${s.key}-${s.startMs}`}>
                  <tr>
                    <th scope="row" className="w-36 pr-3 text-left font-normal">
                      {isHost ? (
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => setOpen((v) => !v)}
                          className="pressable rounded text-left underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-brand"
                        >
                          {s.label}
                        </button>
                      ) : (
                        s.label
                      )}
                    </th>
                    <td className="relative h-6">
                      <Bar left={s.startMs / span} width={(s.endMs - s.startMs) / span} />
                    </td>
                    <td className={cn(TABULAR, 'w-20 text-right')}>{s.endMs - s.startMs} ms</td>
                    <td className="hidden w-20 pl-3 text-muted-foreground sm:table-cell">
                      {s.actor}
                    </td>
                  </tr>
                  {isHost && open && gen.breakdown && (
                    <tr>
                      <td colSpan={4}>
                        <Breakdown bd={gen.breakdown} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      {gen.breakdown && !hosted && <Breakdown bd={gen.breakdown} />}
    </>
  );
}

function Breakdown({ bd }: { bd: WakeBreakdown }) {
  return (
    <div className="flex flex-col gap-3 py-2 sm:pl-4">
      {bd.beforeWindow.length > 0 && (
        <PhaseTable
          caption="Before restore (not in the total)"
          phases={bd.beforeWindow}
          total={bd.totalMs}
        />
      )}
      <PhaseTable
        caption={`${PHASE_TITLE[bd.kind]}, ${bd.totalMs} ms total`}
        phases={bd.phases}
        total={bd.totalMs}
        largest={bd.largest}
        artifacts={bd.artifacts}
      />
      {bd.totalMs > 0 && bd.phaseSumMs !== bd.totalMs && (
        <p className="text-xs text-muted-foreground">
          Phases can overlap. Their durations add up to {bd.phaseSumMs} ms against a total of{' '}
          {bd.totalMs} ms.
        </p>
      )}
    </div>
  );
}

function PhaseTable({
  caption,
  phases,
  total,
  largest,
  artifacts = [],
}: {
  caption: string;
  phases: WakePhase[];
  total: number;
  largest?: WakePhase;
  artifacts?: WakeArtifact[];
}) {
  const hasResolve = phases.some((p) => p.key === 'resolve_images_ms');
  return (
    <table className="w-full text-xs">
      <caption className="label-mono mb-1 text-left text-muted-foreground">{caption}</caption>
      <thead className="sr-only">
        <tr>
          <th>Phase</th>
          <th>Share of total</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        {phases.map((p) => (
          <Fragment key={p.key}>
            <tr>
              <th scope="row" className="py-1 pr-3 text-left font-normal sm:w-64">
                <span>{p.label}</span>{' '}
                <span className="font-mono text-[10px] text-muted-foreground">{p.key}</span>
              </th>
              <td className="relative h-6">
                <Bar left={0} width={p.share} tone={p.key === largest?.key ? 'brand' : 'neutral'} />
              </td>
              <td className={cn(TABULAR, 'w-20 text-right')}>{p.ms} ms</td>
            </tr>
            {p.key === 'resolve_images_ms' &&
              artifacts.map((a) => <ArtifactRow key={a.artifact} artifact={a} total={total} />)}
          </Fragment>
        ))}
        {!hasResolve &&
          artifacts.map((a) => <ArtifactRow key={a.artifact} artifact={a} total={total} />)}
      </tbody>
    </table>
  );
}

function ArtifactRow({ artifact, total }: { artifact: WakeArtifact; total: number }) {
  const fetched = artifact.source === 'materialized';
  return (
    <tr>
      <th scope="row" className="py-1 pl-4 pr-3 text-left font-normal">
        <span className="font-mono">{artifact.artifact}</span>{' '}
        <Pill
          label={SOURCE_LABELS[artifact.source]}
          color={fetched ? 'var(--status-warning)' : undefined}
        />
        {artifact.bytes !== undefined && (
          <span className="text-muted-foreground"> {formatUsageBytes(artifact.bytes)}</span>
        )}
      </th>
      <td className="relative h-6">
        <Bar
          left={0}
          width={total > 0 ? artifact.durationMs / total : 0}
          tone={fetched ? 'warning' : 'neutral'}
        />
      </td>
      <td className={cn(TABULAR, 'w-20 text-right')}>{artifact.durationMs} ms</td>
    </tr>
  );
}

function FirstByte({ firstByte }: { firstByte: WakeFirstByte }) {
  const phases = Object.entries(firstByte.gatewayPhasesMs);
  if (firstByte.latencyMs === undefined && firstByte.proxyLatencyMs === undefined && !phases.length)
    return null;
  const rows: [string, number][] = [
    ...(firstByte.latencyMs !== undefined
      ? [['Request to first byte', firstByte.latencyMs] as [string, number]]
      : []),
    ...(firstByte.proxyLatencyMs !== undefined
      ? [['Final proxy hop', firstByte.proxyLatencyMs] as [string, number]]
      : []),
    ...phases,
  ];
  return (
    <section aria-label="First byte" className="flex flex-col gap-2">
      <h3 className="label-mono text-muted-foreground">First byte</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs">
        {rows.map(([label, ms]) => (
          <Fragment key={label}>
            <dt className="font-mono text-muted-foreground">{label}</dt>
            <dd className={TABULAR}>{ms} ms</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}

function OtherFrames({
  frames,
  origin,
  open,
}: {
  frames: RawWakeEvent[];
  origin: number;
  open: boolean;
}) {
  if (!frames.length) return null;
  return (
    <details open={open} className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        Other frames ({frames.length})
      </summary>
      <ol className="mt-2 flex flex-col">
        {frames.map((e, i) => {
          const t = Date.parse(e.at);
          const dt = Number.isFinite(t) && Number.isFinite(origin) ? Math.max(0, t - origin) : null;
          return (
            <li
              key={`${e.at}-${e.kind}-${i}`}
              className="flex items-baseline gap-4 border-b border-border py-2 last:border-0"
            >
              <span className={cn(TABULAR, 'w-16 shrink-0 text-right text-muted-foreground')}>
                {dt === null ? '—' : `+${dt} ms`}
              </span>
              <span className="font-mono">{e.kind}</span>
              {e.actor && <span className="text-muted-foreground">{e.actor}</span>}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
```

The "Other frames" rows keep exactly today's "+N ms" offset format, so the existing instance-detail test keeps passing unchanged.

- [ ] **Step 5: Run the component tests**

```bash
npx vitest run --maxWorkers=8 src/components/dashboard/wake-waterfall.test.tsx
```

Expected: PASS. If the 402 test cannot find "Wake timeline", read `plan-gated.tsx` for the heading it renders and match that text. Do not change `PlanGated`.

- [ ] **Step 6: Switch instance detail to the waterfall and delete the old list**

In `src/components/dashboard/instance-detail.tsx`, change line 6 from:

```tsx
import { WakeTimeline } from './wake-timeline';
```

to:

```tsx
import { WakeWaterfall } from './wake-waterfall';
```

and change:

```tsx
<WakeTimeline slug={slug} wakeId={instance.wake_id} />
```

to:

```tsx
<WakeWaterfall slug={slug} wakeId={instance.wake_id} />
```

Then delete the old component:

```bash
git rm src/components/dashboard/wake-timeline.tsx
grep -rn "wake-timeline'" src || echo "no imports left"
```

Expected: `no imports left`.

- [ ] **Step 7: Run the instance tests unchanged**

```bash
npx vitest run --maxWorkers=8 src/routes/-dashboard.instances.test.tsx src/components/dashboard/wake-waterfall.test.tsx src/lib/wake-anatomy.test.ts
```

Expected: PASS. The instance test's frames (`wake.queued`, `vm.ready`) are not canonical, so they render under "Other frames", which opens when there are no stages, with the same `+125 ms` text the test expects. If the instance test's API mock rejects the new `query` parameter, read how it destructures its arguments and fix the mock in the test, not the hook.

- [ ] **Step 8: Typecheck, lint and format**

```bash
npx tsc --noEmit && npm run lint && npx prettier --write src/lib/api/queries.ts src/components/dashboard/wake-waterfall.tsx src/components/dashboard/wake-waterfall.test.tsx src/components/dashboard/instance-detail.tsx
```

Expected: tsc exits 0; lint 0 errors and 4 warnings. Rerun the Step 7 command after Prettier and expect PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/api/queries.ts src/components/dashboard/wake-waterfall.tsx src/components/dashboard/wake-waterfall.test.tsx src/components/dashboard/instance-detail.tsx src/components/dashboard/wake-timeline.tsx
git commit -m "feat(console): show a wake as a time axis and a phase breakdown

Instance detail listed a wake's frames as names and offsets. WakeWaterfall
leads with the total and the phase that took most of it, lays the real
milestones on an axis, and opens the restore, cold-boot or thaw breakdown
under the ready row, with artifact cache sources and an overlap note when
the phases do not add up. Failures, stalls and fallbacks lead instead.
The timeline hook now pages forward with since, so long-lived frozen VMs
can load their later thaws."
```

---

### Task 3: A right-side drawer for one wake

**Files:**

- Modify: `src/components/ui/modal.tsx`
- Test: `src/components/ui/modal.test.tsx`
- Create: `src/components/dashboard/wake-drawer.tsx`
- Test: `src/components/dashboard/wake-drawer.test.tsx`

**Interfaces:**

- Consumes from Task 2: `WakeWaterfall({ slug, wakeId })`.
- Produces:
  - `Modal` gains `placement?: 'center' | 'right'`, default `'center'`. The panel carries `data-placement`.
  - `export function WakeDrawer({ slug, wakeId, onClose }: { slug?: string; wakeId?: string; onClose: () => void })`. Open only when both `slug` and `wakeId` are non-empty. Dialog name "Wake".

- [ ] **Step 1: Write the failing Modal test**

Append to `src/components/ui/modal.test.tsx`:

```tsx
it('opens as a right-side drawer with the same Escape and focus behaviour', async () => {
  function Drawer() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open wake</button>
        <Modal open={open} title="Wake" placement="right" onClose={() => setOpen(false)}>
          <button>Inside</button>
        </Modal>
      </>
    );
  }
  render(<Drawer />);
  const trigger = screen.getByRole('button', { name: 'Open wake' });
  await userEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Wake' });
  expect(dialog).toHaveAttribute('data-placement', 'right');
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
});
```

- [ ] **Step 2: Write the failing drawer tests**

Create `src/components/dashboard/wake-drawer.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WakeDrawer } from './wake-drawer';

vi.mock('./wake-waterfall', () => ({
  WakeWaterfall: ({ slug, wakeId }: { slug: string; wakeId: string }) => (
    <p>
      waterfall {slug} {wakeId}
    </p>
  ),
}));

describe('WakeDrawer', () => {
  it('shows the wake for the app over the page', () => {
    render(<WakeDrawer slug="api" wakeId="wk-1" onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Wake' });
    expect(dialog).toHaveAttribute('data-placement', 'right');
    expect(screen.getByText('waterfall api wk-1')).toBeInTheDocument();
    expect(screen.getByText('App api')).toBeInTheDocument();
  });

  it.each([
    [undefined, 'wk-1'],
    ['api', undefined],
    ['api', ''],
  ])('stays closed without both an app and a wake (%s, %s)', (slug, wakeId) => {
    // A pasted Analytics link can carry a wake but no app: the page must render normally.
    render(<WakeDrawer slug={slug} wakeId={wakeId} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<WakeDrawer slug="api" wakeId="wk-1" onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: Run both and confirm they fail**

```bash
npx vitest run --maxWorkers=8 src/components/ui/modal.test.tsx src/components/dashboard/wake-drawer.test.tsx
```

Expected: FAIL. The Modal test finds no `data-placement` attribute, and `./wake-drawer` does not exist.

- [ ] **Step 4: Add `placement` to `Modal`**

In `src/components/ui/modal.tsx`:

Add `placement = 'center',` after `width = 'max-w-md',` in the destructured props, and add to the props type after `width?: string;`:

```ts
  /** `right` slides in a full-height drawer; `width` then does not apply. */
  placement?: 'center' | 'right';
```

Add after `useFocusTrap(panelRef, open);`:

```ts
const right = placement === 'right';
```

Replace the outer container line:

```tsx
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
```

with:

```tsx
        <div
          className={
            right
              ? 'fixed inset-0 z-[95] flex items-stretch justify-end'
              : 'fixed inset-0 z-[95] flex items-center justify-center p-4'
          }
        >
```

In the panel `motion.div`, add `data-placement={placement}` after `aria-describedby={...}`, and replace its `initial`, `exit` and `className` props with:

```tsx
            initial={reduce ? false : right ? { opacity: 0, x: 24 } : { opacity: 0, scale: 0.98, y: -6 }}
            animate={right ? { opacity: 1, x: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={
              reduce
                ? { opacity: 0, transition: { duration: 0 } }
                : right
                  ? { opacity: 0, x: 24, transition: { duration: 0.12, ease: EASE } }
                  : {
                      opacity: 0,
                      scale: 0.98,
                      y: -6,
                      transition: { duration: 0.12, ease: EASE },
                    }
            }
```

(remove the old `animate={{ opacity: 1, scale: 1, y: 0 }}` line, since the new `animate` replaces it), and:

```tsx
            className={
              right
                ? 'relative flex h-dvh w-full flex-col overflow-hidden border-l border-border bg-popover shadow-elevation-3 outline-none sm:max-w-[720px]'
                : `relative flex max-h-[calc(100dvh-2rem)] w-full ${width} flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-elevation-3 outline-none`
            }
```

Leave the header, body, footer, focus trap, Escape handler and scroll lock unchanged.

- [ ] **Step 5: Write `WakeDrawer`**

Create `src/components/dashboard/wake-drawer.tsx`:

```tsx
import { Modal } from '@/components/ui/modal';
import { WakeWaterfall } from './wake-waterfall';

/**
 * One wake's waterfall over the page that opened it. The host owns the URL:
 * it passes the `wake` search param in and removes it in `onClose`. Without
 * an app slug the API cannot be asked, so the drawer stays shut.
 */
export function WakeDrawer({
  slug,
  wakeId,
  onClose,
}: {
  slug?: string;
  wakeId?: string;
  onClose: () => void;
}) {
  const open = Boolean(slug && wakeId);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Wake"
      description={slug ? `App ${slug}` : undefined}
      placement="right"
    >
      {slug && wakeId ? <WakeWaterfall slug={slug} wakeId={wakeId} /> : null}
    </Modal>
  );
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

```bash
npx vitest run --maxWorkers=8 src/components/ui/modal.test.tsx src/components/dashboard/wake-drawer.test.tsx
```

Expected: PASS, including the existing stacked-modal test.

- [ ] **Step 7: Typecheck, lint, format, commit**

```bash
npx tsc --noEmit && npm run lint && npx prettier --write src/components/ui/modal.tsx src/components/ui/modal.test.tsx src/components/dashboard/wake-drawer.tsx src/components/dashboard/wake-drawer.test.tsx
git add src/components/ui/modal.tsx src/components/ui/modal.test.tsx src/components/dashboard/wake-drawer.tsx src/components/dashboard/wake-drawer.test.tsx
git commit -m "feat(console): a right-side drawer for one wake

The shared Modal gains a right placement: a full-height panel up to 720px,
full width on phones, with the same focus trap, Escape handling, scroll
lock and focus return. WakeDrawer hosts a wake's waterfall in it and stays
shut unless both an app and a wake are known, so a pasted link that lacks
the app renders the page as usual."
```

Rerun the Step 6 tests after Prettier and expect PASS before committing.

---

### Task 4: Open a wake from the debugger

**Files:**

- Modify: `src/components/dashboard/debug-search.ts`
- Modify: `src/components/dashboard/debug-request-evidence.tsx`
- Test: `src/components/dashboard/debug-request-evidence.test.tsx`
- Modify: `src/components/dashboard/debug-body.tsx`
- Modify: `src/routes/dashboard.debug.tsx`
- Modify: `src/routes/dashboard.apps.$appSlug.tsx`
- Test: `src/routes/-dashboard.debug.test.tsx`

**Interfaces:**

- Consumes from Task 3: `WakeDrawer({ slug, wakeId, onClose })`.
- Produces:
  - `DebugSearch.wake?: string`, cleaned by `validateDebugSearch` like `request`. The app page's search already spreads `validateDebugSearch`, so it gains `wake` too.
  - `DebugRequestEvidence` gains `onOpenWake?: (wakeId: string) => void`.
  - The app page mounts one `WakeDrawer` for its whole page (Task 5 reuses it).

- [ ] **Step 1: Write the failing evidence test**

In `src/components/dashboard/debug-request-evidence.test.tsx`, add `import userEvent from '@testing-library/user-event';` if it is not imported, then append inside the top-level `describe` (or at the end of the file if tests are top-level):

```tsx
it('offers the wake a cold request admitted, and nothing for a warm one', async () => {
  const onOpenWake = vi.fn();
  const base = useDebugRequestEvidence('api', 'req1');
  useDebugRequestEvidence.mockReturnValue({
    ...base,
    data: { ...base.data, request: { ...base.data.request, cold_boot: true, wake_id: 'wk-7' } },
  });
  const { unmount } = render(
    <DebugRequestEvidence slug="api" reqId="req1" onClose={vi.fn()} onOpenWake={onOpenWake} />
  );
  await userEvent.click(screen.getByRole('button', { name: 'Woke the app · Open wake' }));
  expect(onOpenWake).toHaveBeenCalledWith('wk-7');
  unmount();

  useDebugRequestEvidence.mockReturnValue(base);
  render(
    <DebugRequestEvidence slug="api" reqId="req1" onClose={vi.fn()} onOpenWake={onOpenWake} />
  );
  expect(
    screen.queryByRole('button', { name: 'Woke the app · Open wake' })
  ).not.toBeInTheDocument();
});
```

This relies on the test file's existing `beforeEach`, which sets the hoisted `useDebugRequestEvidence` mock to return a ready evidence object for a warm request (`cold_boot: false`, no `wake_id`).

- [ ] **Step 2: Write the failing debugger route tests**

In `src/routes/-dashboard.debug.test.tsx`:

Add `wake_id: 'wk-cold',` to the fixture request with `id: 'cold'` (after its `cold_boot: true,`).

Inside the `vi.mock('@/lib/api/queries', …)` return object, add after `useCompareDeployments`:

```ts
    useWakeTimeline: (_slug: string, wakeId: string) => ({
      data: {
        pages: [
          {
            wake_id: wakeId,
            app_id: 'app-1',
            limit: 1000,
            next_cursor: '',
            events: [
              {
                at: '2026-09-11T09:00:00.000Z',
                kind: 'wake.boot_started',
                actor: 'schedd',
                data: { method: 'restore' },
              },
              {
                at: '2026-09-11T09:00:00.250Z',
                kind: 'wake.boot_completed',
                actor: 'schedd',
                data: { method: 'restore' },
              },
            ],
          },
        ],
      },
      isPending: false,
      error: null,
      refetch: fixtures.retry,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    }),
```

Append inside `describe('Debugger investigation navigation', …)`:

```tsx
it('opens the wake a cold request admitted, one dialog at a time, and returns to the evidence', async () => {
  const router = await mount('/dashboard/debug?app=alpha&request=cold');
  await userEvent.click(await screen.findByRole('button', { name: 'Woke the app · Open wake' }));
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({ request: 'cold', wake: 'wk-cold' })
  );
  const drawer = await screen.findByRole('dialog', { name: 'Wake' });
  expect(within(drawer).getAllByText('250 ms').length).toBeGreaterThan(0);
  // The evidence dialog steps aside while the wake is open.
  await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(router.state.location.search.wake).toBeUndefined());
  expect(router.state.location.search).toMatchObject({ request: 'cold' });
  expect(await screen.findByRole('heading', { name: 'What happened' })).toBeInTheDocument();
});

it('opens a wake from a pasted link in the app Debugger tab', async () => {
  await mount('/dashboard/apps/alpha?tab=Debugger&wake=wk-cold');
  expect(await screen.findByRole('dialog', { name: 'Wake' })).toBeInTheDocument();
});
```

- [ ] **Step 3: Run both and confirm they fail**

```bash
npx vitest run --maxWorkers=8 src/components/dashboard/debug-request-evidence.test.tsx src/routes/-dashboard.debug.test.tsx
```

Expected: FAIL. There is no "Woke the app · Open wake" button and no "Wake" dialog.

- [ ] **Step 4: Add `wake` to the debugger's search**

In `src/components/dashboard/debug-search.ts`, add `wake?: string;` to `DebugSearch` after `request?: string;`, and add `'wake',` to the list of string keys in `validateDebugSearch`, after `'request',`.

- [ ] **Step 5: Add the Wake row to the evidence**

In `src/components/dashboard/debug-request-evidence.tsx`:

Add `onOpenWake,` after `onRegression,` in the destructured props, and to the props type after `onRegression?: (key: string) => void;`:

```ts
  /** Present when the host can open a wake; the row appears only for a request that admitted one. */
  onOpenWake?: (wakeId: string) => void;
```

Directly after the block that ends:

```tsx
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="mt-1 break-words font-mono">{value}</dd>
                    </div>
                  ))}
```

add:

```tsx
{
  data.request.wake_id && onOpenWake && (
    <div>
      <dt className="text-muted-foreground">Wake</dt>
      <dd className="mt-1">
        <button
          type="button"
          onClick={() => onOpenWake(data.request.wake_id!)}
          className="pressable rounded text-left font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Woke the app · Open wake
        </button>
      </dd>
    </div>
  );
}
```

- [ ] **Step 6: Let the evidence step aside while a wake is open**

In `src/components/dashboard/debug-body.tsx`, in the `<DebugRequestEvidence` element, change:

```tsx
          reqId={search.request}
```

to:

```tsx
          // One dialog at a time: the evidence steps aside while a wake is
          // open and returns when the drawer closes, since `request` stays.
          reqId={search.wake ? null : search.request}
          onOpenWake={(wake) => onSelect({ wake })}
```

The element sits inside a `search.request &&` guard, so `search.request` is a string there and the new expression is `string | null`, which `reqId` accepts.

- [ ] **Step 7: Mount the drawer on the debugger page**

In `src/routes/dashboard.debug.tsx`, add the import:

```ts
import { WakeDrawer } from '@/components/dashboard/wake-drawer';
```

and add, as the last child of the root `<div className="flex flex-col gap-6">` that `DebugPage` returns:

```tsx
<WakeDrawer
  slug={available ? slug : undefined}
  wakeId={search.wake}
  onClose={() =>
    void navigate({
      search: (current) => ({ ...current, wake: undefined }),
      replace: true,
      hash: true,
      resetScroll: false,
    })
  }
/>
```

- [ ] **Step 8: Mount the drawer on the app page**

In `src/routes/dashboard.apps.$appSlug.tsx`, add the import:

```ts
import { WakeDrawer } from '@/components/dashboard/wake-drawer';
```

and add, directly before the comment `{/* The one deploy the console can start itself: a Git ref, built`:

```tsx
<WakeDrawer
  slug={fn.id}
  wakeId={search.wake}
  onClose={() =>
    void navigate({
      search: (current) => ({ ...current, wake: undefined }),
      replace: true,
      hash: true,
      resetScroll: false,
    })
  }
/>
```

This one drawer serves both the app's Debugger tab and the recent-wakes panel on its Overview tab (Task 5).

- [ ] **Step 9: Run the tests and confirm they pass**

```bash
npx vitest run --maxWorkers=8 src/components/dashboard/debug-request-evidence.test.tsx src/routes/-dashboard.debug.test.tsx src/components/dashboard/debug-search.test.ts
```

Expected: PASS, including every existing debugger test.

- [ ] **Step 10: Typecheck, lint, format, commit**

```bash
npx tsc --noEmit && npm run lint && npx prettier --write src/components/dashboard/debug-search.ts src/components/dashboard/debug-request-evidence.tsx src/components/dashboard/debug-request-evidence.test.tsx src/components/dashboard/debug-body.tsx src/routes/dashboard.debug.tsx src/routes/dashboard.apps.\$appSlug.tsx src/routes/-dashboard.debug.test.tsx
```

Rerun the Step 9 tests after Prettier and expect PASS, then:

```bash
git add src/components/dashboard/debug-search.ts src/components/dashboard/debug-request-evidence.tsx src/components/dashboard/debug-request-evidence.test.tsx src/components/dashboard/debug-body.tsx src/routes/dashboard.debug.tsx src/routes/dashboard.apps.\$appSlug.tsx src/routes/-dashboard.debug.test.tsx
git commit -m "feat(console): open the wake a slow cold request admitted

Debugger evidence for a request that admitted a wake now has a Wake row
that opens its waterfall in the drawer, with the wake in the URL so the
link can be shared. The evidence dialog steps aside while the wake is open
and returns when the drawer closes, so only one dialog is ever on screen.
The app page hosts the same drawer for its Debugger tab."
```

---

### Task 5: Open a wake from the recent-wakes panel

**Files:**

- Modify: `src/components/dashboard/app-insights.tsx` (`WakeTimelinePanel`)
- Test: `src/components/dashboard/app-insights.test.tsx`
- Modify: `src/routes/dashboard.apps.$appSlug.tsx` (the `<WakeTimelinePanel slug={fn.id} />` line)
- Modify: `src/components/dashboard/account-analytics.tsx`
- Modify: `src/routes/dashboard.analytics.tsx`
- Test: `src/routes/-dashboard.analytics-wake.test.ts`

**Interfaces:**

- Consumes from Task 3: `WakeDrawer`. From Task 4: the app page's drawer mount.
- Produces:
  - `WakeTimelinePanel({ slug, onOpenWake }: { slug: string; onOpenWake?: (wakeId: string) => void })`.
  - `AccountAnalyticsSearch.wake?: string`.
  - `AccountAnalytics` gains `onOpenWake?: (wakeId: string, slug: string) => void`. It passes the shown app's slug because Analytics may show a default app that isn't in the URL.

- [ ] **Step 1: Write the failing panel test**

In `src/components/dashboard/app-insights.test.tsx`, add `import userEvent from '@testing-library/user-event';` and append inside `describe('WakeTimelinePanel', …)`:

```tsx
it('opens a wake from its row, and only rows with a wake ID offer it', async () => {
  const base = useAppWakeTimeline('api');
  useAppWakeTimeline.mockReturnValue({
    ...base,
    data: { ...base.data, rows: [{ ...base.data.rows[0], wake_id: 'wk-1' }, base.data.rows[1]] },
  });
  const onOpenWake = vi.fn();
  render(<WakeTimelinePanel slug="api" onOpenWake={onOpenWake} />);
  expect(screen.getAllByRole('button', { name: /^Open wake/ })).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Open wake wk-1' }));
  expect(onOpenWake).toHaveBeenCalledWith('wk-1');
});

it('offers no open buttons when the host cannot open a wake', () => {
  render(<WakeTimelinePanel slug="api" />);
  expect(screen.queryByRole('button', { name: /^Open wake/ })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Write the failing Analytics test**

Create `src/routes/-dashboard.analytics-wake.test.ts`:

```ts
import { expect, it } from 'vitest';
import { Route } from './dashboard.analytics';

const validate = Route.options.validateSearch as (
  search: Record<string, unknown>
) => Record<string, unknown>;

it('keeps a wake in the Analytics URL and drops an empty one', () => {
  expect(validate({ app: 'api', wake: 'wk-1' })).toMatchObject({ app: 'api', wake: 'wk-1' });
  expect(validate({ app: 'api', wake: '   ' })).not.toHaveProperty('wake');
  expect(validate({ wake: 42 })).not.toHaveProperty('wake');
});
```

- [ ] **Step 3: Run both and confirm they fail**

```bash
npx vitest run --maxWorkers=8 src/components/dashboard/app-insights.test.tsx src/routes/-dashboard.analytics-wake.test.ts
```

Expected: FAIL. There is no "Open wake wk-1" button, and the validator drops `wake`.

- [ ] **Step 4: Give recent-wakes rows an open button**

In `src/components/dashboard/app-insights.tsx`:

Change the signature line `export function WakeTimelinePanel({ slug }: { slug: string }) {` to:

```tsx
export function WakeTimelinePanel({
  slug,
  onOpenWake,
}: {
  slug: string;
  /** Present when the host page can open a wake in its drawer. */
  onOpenWake?: (wakeId: string) => void;
}) {
```

and directly after the relative-time span at the end of each row:

```tsx
<span className="w-16 text-right text-muted-foreground">{relativeTime(row.at)}</span>
```

add:

```tsx
{
  row.wake_id && onOpenWake && (
    <Button
      size="xs"
      variant="ghost"
      aria-label={`Open wake ${row.wake_id}`}
      onClick={() => onOpenWake(row.wake_id!)}
    >
      Open
    </Button>
  );
}
```

`Button` is already imported in this file.

- [ ] **Step 5: Wire the app page's panel**

In `src/routes/dashboard.apps.$appSlug.tsx`, change:

```tsx
<WakeTimelinePanel slug={fn.id} />
```

to:

```tsx
<WakeTimelinePanel
  slug={fn.id}
  onOpenWake={(wake) =>
    void navigate({
      search: (current) => ({ ...current, wake }),
      hash: true,
      resetScroll: false,
    })
  }
/>
```

- [ ] **Step 6: Wire Analytics**

In `src/components/dashboard/account-analytics.tsx`:

Add `wake?: string;` to `AccountAnalyticsSearch` after `method?: …;`.

Change `export function AccountAnalytics({ search, setSearch }: SearchProps) {` to:

```tsx
export function AccountAnalytics({
  search,
  setSearch,
  onOpenWake,
}: SearchProps & { onOpenWake?: (wakeId: string, slug: string) => void }) {
```

and change `<WakeTimelinePanel slug={slug} />` to:

```tsx
<WakeTimelinePanel slug={slug} onOpenWake={onOpenWake && ((wake) => onOpenWake(wake, slug))} />
```

In `src/routes/dashboard.analytics.tsx`:

Add the import `import { WakeDrawer } from '@/components/dashboard/wake-drawer';`.

In the validator's returned object, add after the `...(search.window === …)` line:

```ts
      ...(typeof search.wake === 'string' && search.wake.trim() ? { wake: search.wake } : {}),
```

In `AnalyticsPage`, add after `setSearch`:

```tsx
// Opening pushes, so Back closes the drawer; the app is pinned because the
// page may be showing a default app that is not in the URL.
const openWake = (wake: string, app: string) =>
  void navigate({ search: (previous) => ({ ...previous, app, wake }), resetScroll: false });
const closeWake = () =>
  void navigate({
    search: (previous) => ({ ...previous, wake: undefined }),
    replace: true,
    resetScroll: false,
  });
```

and change `<AccountAnalytics search={search} setSearch={setSearch} />` to:

```tsx
      <AccountAnalytics search={search} setSearch={setSearch} onOpenWake={openWake} />
      <WakeDrawer slug={search.app} wakeId={search.wake} onClose={closeWake} />
```

- [ ] **Step 7: Run the tests and confirm they pass**

```bash
npx vitest run --maxWorkers=8 src/components/dashboard/app-insights.test.tsx src/routes/-dashboard.analytics-wake.test.ts src/components/dashboard/account-analytics.test.tsx src/routes/-dashboard.debug.test.tsx
```

Expected: PASS, including the existing analytics and debugger tests.

- [ ] **Step 8: Typecheck, lint, format, commit**

```bash
npx tsc --noEmit && npm run lint && npx prettier --write src/components/dashboard/app-insights.tsx src/components/dashboard/app-insights.test.tsx src/routes/dashboard.apps.\$appSlug.tsx src/components/dashboard/account-analytics.tsx src/routes/dashboard.analytics.tsx src/routes/-dashboard.analytics-wake.test.ts
```

Rerun the Step 7 tests after Prettier and expect PASS, then:

```bash
git add src/components/dashboard/app-insights.tsx src/components/dashboard/app-insights.test.tsx src/routes/dashboard.apps.\$appSlug.tsx src/components/dashboard/account-analytics.tsx src/routes/dashboard.analytics.tsx src/routes/-dashboard.analytics-wake.test.ts
git commit -m "feat(console): open a recent wake from the wake timeline panel

Each row in the last-24-hours wake list carried a wake ID that led nowhere.
Rows with one now open its waterfall in the drawer on the app page and on
Analytics. Analytics pins the shown app in the URL when it opens a wake,
because it may be showing a default app the URL does not name."
```

---

### Task 6: A mock that speaks the real wake vocabulary

**Files:**

- Modify: `mock/plugin.ts` (the `/v1/apps/{slug}/wakes/{wake_id}/timeline` route near line 6173, and the debug evidence route near line 2077)

**Interfaces:**

- Consumes: nothing from `src/`. The mock never imports `src/`.
- Produces: deterministic canonical scenarios per wake ID; 402 under `MOCK_PLAN=free`; `wake_id` on cold debugger evidence.

- [ ] **Step 1: Confirm the drift test is green before the change**

```bash
npx vitest run --maxWorkers=8 src/lib/mock-spec-drift.test.ts
```

Expected: PASS. Record it, since this task adds no new paths and the test must stay green.

- [ ] **Step 2: Replace the per-wake timeline route**

In `mock/plugin.ts`, replace the whole `route('GET', '/v1/apps/{slug}/wakes/{wake_id}/timeline', …)` block, from that line through its closing `});`, with:

```ts
// Canonical ADR-064 frames, one stable story per wake id: recent-wake rows
// carry random ids, and each must open the same scenario every time.
const WAKE_SCENARIOS = [
  'restore',
  'restore',
  'restore',
  'fetched',
  'cold_boot',
  'thaw',
  'fallback',
  'failed',
  'stalled',
] as const;
function wakeScenario(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return WAKE_SCENARIOS[h % WAKE_SCENARIOS.length];
}
function mockRestoreBreakdown(fetched: boolean) {
  return {
    lease_acquire_ms: 2,
    env_prepare_ms: 1,
    pre_network_ms: 0,
    setup_network_ms: 3,
    restore_gate_wait_ms: 0,
    chroot_ms: 4,
    materialize_mem_ms: 12,
    materialize_vmstate_ms: 2,
    resolve_images_ms: fetched ? 640 : 6,
    stage_drives_ms: 9,
    stage_pre_boot_files_ms: 7,
    stage_snapshot_ms: 3,
    helper_ms: 5,
    start_jailer_ms: 11,
    bind_tun_ms: 8,
    load_snapshot_ms: 142,
    resume_hook_ms: 14,
    wait_ready_ms: 40,
    total_ms: fetched ? 936 : 302,
    resolve_artifacts: [
      { artifact: 'kernel', source: 'cache_hit', duration_ms: 1, bytes: 12_000_000 },
      { artifact: 'base', source: 'backend_local', duration_ms: 2, bytes: 210_000_000 },
      fetched
        ? { artifact: 'main', source: 'materialized', duration_ms: 636, bytes: 480_000_000 }
        : { artifact: 'main', source: 'cache_hit', duration_ms: 3, bytes: 480_000_000 },
    ],
  };
}
route('GET', '/v1/apps/{slug}/wakes/{wake_id}/timeline', ({ params }) => {
  if (process.env.MOCK_PLAN === 'free')
    throw new Problem(
      402,
      'plan_per_app_metrics_not_allowed',
      'the free plan does not include per-app metrics; upgrade to Hobby or above.'
    );
  const a = app(params.slug);
  const scenario = wakeScenario(params.wake_id);
  const t0 = Date.now() - 3600e3;
  const frames: { dt: number; kind: string; actor: string; data: Record<string, unknown> }[] = [];
  const f = (dt: number, kind: string, actor: string, data: Record<string, unknown> = {}) =>
    frames.push({ dt, kind, actor, data: { wake_id: params.wake_id, app_id: a.id, ...data } });

  if (scenario === 'cold_boot') {
    f(0, 'wake.queue_accepted', 'schedd', { queue_wait_ms: 0 });
    f(3, 'wake.admitted', 'schedd');
    f(6, 'wake.boot_started', 'schedd', { method: 'cold_boot' });
    f(905, 'wake.cold_boot_breakdown', 'vmmd', {
      resolve_images_ms: 120,
      chroot_ms: 5,
      provision_ms: 40,
      stage_runtime_ms: 30,
      prepare_config_ms: 4,
      helper_ms: 6,
      start_jailer_ms: 12,
      bind_tun_ms: 9,
      cgroup_ms: 3,
      write_config_ms: 2,
      wait_ready_ms: 640,
      quota_restore_ms: 1,
      total_ms: 872,
      resolve_artifacts: [
        { artifact: 'base', source: 'direct', duration_ms: 120, bytes: 210_000_000 },
      ],
    });
    f(906, 'wake.readiness_200', 'vmmd', { probe_count: 9, elapsed_ms: 640 });
    f(914, 'wake.boot_completed', 'schedd', { method: 'cold_boot' });
    f(940, 'wake.proxy_first_byte', 'gatewayd', { latency_ms: 940, proxy_latency_ms: 4 });
  } else if (scenario === 'failed') {
    f(0, 'wake.queue_accepted', 'schedd', { queue_wait_ms: 0 });
    f(3, 'wake.admitted', 'schedd');
    f(6, 'wake.boot_started', 'schedd', { method: 'restore' });
    f(720, 'wake.boot_failed', 'schedd', { method: 'restore', reason: 'readiness_timeout' });
  } else if (scenario === 'stalled') {
    f(0, 'wake.queue_accepted', 'schedd', { queue_wait_ms: 12 });
    f(4, 'wake.admitted', 'schedd');
    f(8, 'wake.boot_started', 'schedd', { method: 'restore' });
    f(30_000, 'wake.stalled', 'schedd', { reason: 'watchdog_timeout' });
    f(30_001, 'state_transition', 'schedd', { from: 'BOOTING', to: 'FAILED' });
    f(30_002, 'wake.cold_boot_cpu', 'vmmd', { startup_cpu_millicores: 1000 });
  } else {
    const fetched = scenario === 'fetched';
    const bd = mockRestoreBreakdown(fetched);
    const ready = 9 + bd.total_ms - 20;
    f(0, 'wake.queue_accepted', 'schedd', { queue_wait_ms: 0 });
    f(4, 'wake.admitted', 'schedd');
    f(9, 'wake.boot_started', 'schedd', { method: 'restore' });
    f(ready - 1, 'wake.restore_breakdown', 'vmmd', bd);
    f(ready, 'wake.readiness_200', 'vmmd', { probe_count: 2, elapsed_ms: 40 });
    f(ready + 8, 'wake.boot_completed', 'schedd', {
      method: scenario === 'fallback' ? 'cold_boot' : 'restore',
      ...(scenario === 'fallback' ? { restore_fallback_reason: 'after_restore_failed' } : {}),
    });
    f(ready + 29, 'wake.proxy_first_byte', 'gatewayd', {
      latency_ms: ready + 29,
      proxy_latency_ms: 3,
      gateway_phases_ms: { route: 1, wake_wait: ready + 20 },
    });
    if (scenario === 'thaw') {
      for (const at of [600_000, 1_200_000]) {
        f(at, 'wake.thaw_breakdown', 'schedd', {
          wake_reads_ms: 1,
          thaw_reads_ms: 2,
          vmmd_thaw_ms: 20,
          publish_ms: 1,
          after_publish_ms: 2,
          total_ms: 26,
        });
        f(at + 30, 'wake.proxy_first_byte', 'gatewayd', { latency_ms: 30 });
      }
    }
  }

  return {
    wake_id: params.wake_id,
    app_id: a.id,
    events: frames.map(({ dt, kind, actor, data }) => ({
      at: new Date(t0 + dt).toISOString(),
      kind,
      actor,
      data,
    })),
    next_cursor: '',
    limit: 1000,
  };
});
```

- [ ] **Step 3: Give cold debugger evidence a wake ID**

In the `/v1/apps/{slug}/debug/requests/{req_id}/evidence` route, replace the single line:

```ts
      cold_boot: false,
```

with:

```ts
      // Even-led request ids woke the app, so the debugger can open a wake.
      cold_boot: parseInt(params.req_id[0], 16) % 2 === 0,
      ...(parseInt(params.req_id[0], 16) % 2 === 0
        ? { wake_id: `wk-${params.req_id.slice(0, 12)}` }
        : {}),
```

That line occurs exactly once in the file.

- [ ] **Step 4: Typecheck the mock and run the drift test**

```bash
npx tsc --noEmit && npx vitest run --maxWorkers=8 src/lib/mock-spec-drift.test.ts && npx prettier --write mock/plugin.ts
```

Expected: tsc exits 0 (the mock is part of the typecheck), and the drift test passes. If tsc complains that `a.id` does not exist, read `db.appBySlug`'s return type and use the field it calls the app's id.

- [ ] **Step 5: Check the scenarios by hand**

Start the mock in the background:

```bash
npm run dev:mock
```

Once Vite prints its ready line, run:

```bash
for id in a1 b2 c3 d4 e5 f6 g7 h8 i9 j10; do printf "%s " $id; curl -s http://localhost:3000/v1/apps/api-gateway/wakes/$id/timeline | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const e=JSON.parse(s).events;console.log(e.length, e.map(x=>x.kind.replace("wake.","")).join(","))})'; done
MOCK_PLAN=free node -e 1
```

Expected: the ten IDs between them cover restore, fetched, cold boot, thaw, fallback, failed and stalled, every kind is canonical except the two deliberate `state_transition` and `wake.cold_boot_cpu` frames in the stalled scenario. Stop the server afterwards. If one scenario is missing from these ten IDs, add IDs until it appears and note which one in the report; do not change the hash.

- [ ] **Step 6: Commit**

```bash
git add mock/plugin.ts
git commit -m "test(console): mock wakes in the canonical wake.* vocabulary

The dev mock answered the per-wake timeline with invented frame names, so
no screen or test exercised the real shape. It now returns ADR-064 frames
with realistic restore, cold-boot and thaw breakdowns, chosen per wake id
so each recent-wake row opens a stable story, including a fetched artifact,
a fallback, a failed boot and a stall. Free returns the API's 402, and cold
debugger evidence carries a wake id so its Open wake row appears."
```

---

### Task 7: Verify the branch and walk it in a browser

No code changes unless a check fails.

**Files:** none.

**Interfaces:**

- Consumes: Tasks 1–6 committed.
- Produces: a verification report.

- [ ] **Step 1: Run the full gate**

Run each and record the result:

```bash
npx tsc --noEmit
```

```bash
npm run lint
```

```bash
npx prettier --check $(git ls-files '*.ts' '*.tsx' '*.css' '*.json' '*.md')
```

```bash
npx vitest run --maxWorkers=8
```

```bash
npm run build
```

Expected: tsc exit 0; lint 0 errors and 4 warnings; Prettier clean on tracked files; vitest exit 0 with no "Errors" line (record the file and test counts); build succeeds. If a check fails, fix it in the task that owns the file, commit there, and rerun all five.

- [ ] **Step 2: Walk the three entry points on the mock**

Start `npm run dev:mock` in the background and open `http://localhost:3000`. If the sign-in page appears, use the "Dev · open dashboard" button. At 1366×768, check and record:

1. App page, Overview tab: the Wake timeline panel's rows have "Open" buttons. Opening one shows the drawer from the right with `?wake=` in the URL. Browser Back closes it, and Escape closes it without adding a history entry.
2. Open several rows until you have seen a restore, a fetched artifact (warning-toned "Fetched" chip, resolve images largest), a cold boot, a thaw (generation picker), a fallback banner, a failed banner and a stall (with "Other frames").
3. Debugger: open a request whose evidence shows "Woke the app · Open wake". The evidence dialog gives way to the drawer, and closing the drawer brings the evidence back.
4. Analytics with an app selected: rows open the drawer, and the URL gains both `app` and `wake`.
5. Instances: an instance's detail shows the waterfall inline.
6. At 390px wide the drawer fills the screen, and the actor column is hidden.
7. Reload a URL with `?wake=` on each host: the drawer reopens on the same wake.

If the Chrome extension is not connected and Playwright is not installed in this worktree, drive the browser with Playwright from a sibling worktree by absolute import path (for example `/home/bahadir/GREGALE/.worktrees/faas-web-mock-buckets/node_modules/playwright/index.mjs`) from a scratch script outside the repo. Do not install anything. Sign in by setting the same localStorage keys `scripts/tour.mjs` sets.

- [ ] **Step 3: Report**

Stop the dev server. Report the gate results with counts, the Step 2 checklist with any deviations, and anything noticed but not changed. Then hand over to superpowers:finishing-a-development-branch. The PR body must carry the spec's three "Questions for Poyraz", addressed to @poyrazK and marked non-blocking.
