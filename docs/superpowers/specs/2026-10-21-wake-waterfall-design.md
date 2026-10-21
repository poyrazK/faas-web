# Wake waterfall: design

**Status:** approved in conversation on 2026-10-21, section by section, awaiting review of this written spec.
**Branch:** `feat/console-wake-waterfall`, off `main` at 7376e5f. One PR.

## Why

Gregale's core promise is that a sleeping app wakes and answers in a few hundred milliseconds. When a wake is slow, the developer's question is "where did the time go?". The console cannot answer it today:

- **The per-wake view is a list.** `src/components/dashboard/wake-timeline.tsx` (46 lines) prints each event's name and a "+N ms" offset. It is only reachable from the Instance detail modal.
- **Recent wakes lead nowhere.** The app page's "Wake timeline" panel (`WakeTimelinePanel` in `app-insights.tsx`) lists the last 24 hours of wakes. Each row carries a `wake_id`, but nothing opens it.
- **The richest data is never shown.** `GET /v1/apps/{slug}/wakes/{wake_id}/timeline` returns typed `wake.*` events (ADR-064). One of them, `wake.restore_breakdown`, carries about twenty snapshot-restore phases in milliseconds, plus per-artifact cache attribution. Cold boots and thaws have their own breakdown events.
- **The mock is wrong.** `mock/plugin.ts` answers that endpoint with invented names (`restore.started`, `ready`), so no screen or test exercises the real vocabulary.

The audience is a developer debugging one slow wake. The view is dense and precise, like browser devtools. It is not a marketing visual.

## What the data allows

All of this is from `api/openapi.yaml` (the `WakeTimelineEvent` description) and ADR-064 in poyrazK/faas.

### Outer milestones (real timestamps)

| Kind                    | Fields used                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `wake.queue_accepted`   | `queue_wait_ms`                                                                                                                |
| `wake.admitted`         | —                                                                                                                              |
| `wake.boot_started`     | `method`                                                                                                                       |
| `wake.boot_completed`   | `method`, `restore_fallback_reason` (only `after_restore_failed`)                                                              |
| `wake.readiness_200`    | `probe_count`, `elapsed_ms`                                                                                                    |
| `wake.proxy_first_byte` | `latency_ms` (request or queue acceptance through first upstream byte), `proxy_latency_ms`, `gateway_phases_ms` (optional map) |
| `wake.boot_failed`      | `reason`                                                                                                                       |
| `wake.stalled`          | `reason`                                                                                                                       |

`wake.readiness_200` is written by vmmd during boot and can precede schedd's `wake.boot_completed`. Milestones are therefore ordered by timestamp, never by a fixed sequence.

### Breakdowns (durations, not positions)

- **`wake.restore_breakdown`** has these keys, in struct order. The first four (`lease_acquire_ms`, `env_prepare_ms`, `pre_network_ms`, `setup_network_ms`) run before the restore window and are excluded from `total_ms` (ADR-192). The rest: `restore_gate_wait_ms`, `chroot_ms`, `materialize_mem_ms`, `materialize_vmstate_ms`, `resolve_images_ms`, `stage_drives_ms`, `stage_pre_boot_files_ms`, `stage_snapshot_ms`, `helper_ms`, `start_jailer_ms`, `bind_tun_ms`, `load_snapshot_ms`, `resume_hook_ms`, `wait_ready_ms`, then `total_ms`. Also `resolve_artifacts[{artifact, source, duration_ms, bytes}]`, where `source` is `backend_local`, `cache_hit` or `materialized`.
- **`wake.cold_boot_breakdown`** has `resolve_images_ms`, `chroot_ms`, `provision_ms`, `stage_runtime_ms`, `prepare_config_ms`, `helper_ms`, `start_jailer_ms`, `bind_tun_ms`, `cgroup_ms`, `write_config_ms`, `wait_ready_ms`, `quota_restore_ms`, `total_ms`, and the same artifacts list, whose `source` may also be `direct`.
- **`wake.thaw_breakdown`** has `wake_reads_ms`, `thaw_reads_ms`, `vmmd_thaw_ms`, `publish_ms`, `after_publish_ms`, `total_ms`. ADR-064 calls these consecutive spans. A thawed VM keeps its wake ID, so successive thaws share one `wake_id` and differ by time.

**Restore phases overlap.** The vmmd source (`pkg/fcvm/vmm.go`) runs the pre-boot file write concurrently with staging, and overlaps network setup with the restore. Restore phases must never be laid end to end on a time axis, and their sum is not a meaningful remainder.

## Design

### 1. `src/lib/wake-anatomy.ts`: one pure parser

`parseWake(events: WakeTimelineEvent[]): WakeAnatomy` is the only code that knows the `wake.*` vocabulary. It has no React and no fetching.

```ts
type WakeMethod = 'restore' | 'cold_boot' | 'thaw' | 'unknown';

interface WakeSegment {
  key: string; // the milestone kind that ends the segment, e.g. 'wake.admitted'
  label: string; // "Until admitted"
  startMs: number; // offset from t0
  endMs: number;
  actor: string;
  skewed: boolean; // timestamp ran backwards; clamped to zero length
}

interface WakePhase {
  key: string;
  label: string;
  ms: number;
  share: number;
} // share of the breakdown total, 0..1

interface WakeArtifact {
  artifact: string; // kernel | base | main | sidecar:<name>
  source: 'backend_local' | 'cache_hit' | 'materialized' | 'direct' | 'unknown';
  durationMs: number;
  bytes?: number;
}

interface WakeBreakdown {
  kind: 'restore' | 'cold_boot' | 'thaw';
  totalMs: number;
  beforeWindow: WakePhase[]; // restore only: the four ADR-192 phases
  phases: WakePhase[]; // struct order
  artifacts: WakeArtifact[];
  largest?: WakePhase;
  phaseSumMs: number; // compared with totalMs by the UI; never shown as a remainder
}

type WakeOutcome =
  | { status: 'ready' }
  | { status: 'failed'; reason?: string }
  | { status: 'stalled'; reason?: string }
  | { status: 'in_progress' };

interface WakeGeneration {
  t0: number; // epoch ms of the generation's first frame
  totalMs?: number; // see "Headline total"
  method: WakeMethod;
  segments: WakeSegment[];
  breakdown?: WakeBreakdown;
  outcome: WakeOutcome;
  fallback?: 'after_restore_failed';
  firstByte?: {
    latencyMs?: number;
    proxyLatencyMs?: number;
    gatewayPhasesMs: Record<string, number>;
  };
}

interface WakeAnatomy {
  generations: WakeGeneration[]; // oldest first; the UI shows the last by default
  otherFrames: WakeTimelineEvent[]; // unknown, legacy and unused kinds, unchanged
}
```

Rules:

- **Segments.** Sort the canonical milestones by `at`. `t0` is the first milestone, or `queue_accepted.at − queue_wait_ms` when `queue_wait_ms > 0`, which adds a leading "Queued" segment. Each further milestone closes a segment that starts at the previous milestone. Its label comes from the milestone table below. Missing milestones produce no segment. A milestone earlier than its predecessor gives a zero-length segment with `skewed: true`.
- **Headline total.** Use `wake.proxy_first_byte.latency_ms` when present: it is the platform's own request-to-first-byte measurement. Otherwise, use the span from `t0` to the last milestone. In progress, leave it undefined.
- **Method.** Read `method` from `wake.boot_started` or `wake.boot_completed`. Fall back to whichever breakdown event is present, then to `'unknown'`.
- **Breakdown.** Read only the keys listed above for the event's kind, in that order. A value counts only when it is a finite number ≥ 0; anything else is dropped. `share = ms / totalMs`, or 0 when `totalMs` is 0 or missing. `largest` is the phase with the highest `ms`, excluding `beforeWindow`. Artifacts with an unrecognised `source` become `'unknown'`.
- **Outcome.** `wake.boot_failed` gives `failed`. `wake.stalled` without a later `boot_completed` gives `stalled`. A generation with `boot_completed` or `proxy_first_byte` is `ready`. Anything else is `in_progress`. `fallback` is set when `boot_completed.data.restore_fallback_reason === 'after_restore_failed'`.
- **Generations.** Consumed frames are split after each `wake.proxy_first_byte`: a frozen VM's thaws each end with their own first byte, and each thaw's `wake.thaw_breakdown` lands between two of them. Consumed frames after the last first byte form one final, in-progress generation, but only if they include a milestone or a breakdown. A thaw generation's axis starts at its first frame. A wake that was never thawed has exactly one generation.
- **Nothing is hidden.** Every event the parser does not consume goes into `otherFrames`. That includes legacy bare names, park events, `wake.cold_boot_cpu`, `wake.cpu_boost_tail`, `wake.boot_observed` and unknown kinds.

Milestone labels, by the kind that ends the segment:

| Kind                                  | Segment label       |
| ------------------------------------- | ------------------- |
| (queue start) → `wake.queue_accepted` | Queued              |
| → `wake.admitted`                     | Until admitted      |
| → `wake.boot_started`                 | Until boot started  |
| → `wake.readiness_200`                | Until ready         |
| → `wake.boot_completed`               | Until boot recorded |
| → `wake.proxy_first_byte`             | Until first byte    |
| → `wake.boot_failed`                  | Until boot failed   |
| → `wake.stalled`                      | Until stalled       |

Phase labels are console copy. The raw key is always shown next to the label.

| Key                       | Label                 |
| ------------------------- | --------------------- |
| `lease_acquire_ms`        | Acquire lease         |
| `env_prepare_ms`          | Prepare environment   |
| `pre_network_ms`          | Before network        |
| `setup_network_ms`        | Set up network        |
| `restore_gate_wait_ms`    | Wait for restore slot |
| `chroot_ms`               | Create chroot         |
| `materialize_mem_ms`      | Materialise memory    |
| `materialize_vmstate_ms`  | Materialise VM state  |
| `resolve_images_ms`       | Resolve images        |
| `stage_drives_ms`         | Stage drives          |
| `stage_pre_boot_files_ms` | Write pre-boot files  |
| `stage_snapshot_ms`       | Stage snapshot        |
| `helper_ms`               | Run helper            |
| `start_jailer_ms`         | Start jailer          |
| `bind_tun_ms`             | Bind network device   |
| `load_snapshot_ms`        | Load snapshot         |
| `resume_hook_ms`          | Resume hooks          |
| `wait_ready_ms`           | Wait for ready        |
| `provision_ms`            | Provision             |
| `stage_runtime_ms`        | Stage runtime         |
| `prepare_config_ms`       | Prepare config        |
| `cgroup_ms`               | Set up cgroup         |
| `write_config_ms`         | Write config          |
| `quota_restore_ms`        | Restore CPU quota     |
| `wake_reads_ms`           | Read wake state       |
| `thaw_reads_ms`           | Read thaw state       |
| `vmmd_thaw_ms`            | Thaw VM               |
| `publish_ms`              | Publish               |
| `after_publish_ms`        | After publish         |

Artifact source labels: `backend_local` is "Local", `cache_hit` is "Cache hit", `materialized` is "Fetched", `direct` is "Direct" and `unknown` is "Unknown".

### 2. The data hook

`useWakeTimeline(slug, wakeId)` in `src/lib/api/queries.ts` requests `limit: 1000`, the API maximum. When the response has a non-empty `next_cursor`, the waterfall shows a "Load older frames" control. It fetches the next page with `cursor` and prepends it, and the parser re-runs over all frames. The hook keeps its query key shape (`['apps', slug, 'wakes', wakeId]`) so existing invalidations still apply.

### 3. `WakeWaterfall` (`src/components/dashboard/wake-waterfall.tsx`)

Props: `{ slug: string; wakeId: string }`. It replaces `WakeTimeline`, and `wake-timeline.tsx` is deleted once nothing imports it. It is built from existing primitives: `queryPhase` and `InlinePhase` for read states, `PlanGated` for the 402, `CopyIconButton`, `Pill`, theme tokens, `label-mono`, and the motion constants in `dashboard/motion.ts`. There are no new colour tokens, no literal hex and no `dark:` variants.

Top to bottom:

1. **Summary.**
   - It shows the headline total in large monospace, a method pill (Restore, Cold boot, Thaw or Unknown) and an outcome pill.
   - One sentence names the largest phase: "Most of the restore: Load snapshot, 142 ms (47%)." With no breakdown, the sentence names the longest segment instead.
   - A failure, stall or fallback replaces the sentence with a banner. It gives the reason in plain words with the raw code beside it in monospace. For example: "Restore fell back to a cold boot because the app's after-restore callback failed (`after_restore_failed`)."
   - The wake ID is shown with a `CopyIconButton`.
   - A thaw picker ("Thaw 3 of 5") appears only when there is more than one generation, and defaults to the last.
2. **Tier 1, the time axis.**
   - A millisecond ruler sits above one row per segment.
   - Each bar is positioned at `startMs / span` and sized by `(endMs − startMs) / span`, where `span` is the generation's last `endMs`.
   - Each row shows the label, the bar, the milliseconds and the actor. A skewed segment shows a "clock skew" note instead of a bar.
   - The segment that ends at `wake.readiness_200` carries the disclosure for tier 2, because the restore and cold-boot windows end at the first successful readiness probe. Without that milestone it sits on the segment ending at `wake.boot_completed`, and failing that on the last segment.
3. **Tier 2, the breakdown.** It is open by default when a breakdown exists.
   - Each phase is a row: the label, the raw key in small monospace, a bar sized by `share`, and the milliseconds.
   - `largest` uses the brand colour, and the other bars are neutral.
   - For restores, `beforeWindow` phases form a group headed "Before restore (not in the total)", above the main list.
   - Artifacts are sub-rows under "Resolve images", each with a source chip and its size, formatted by the existing byte formatter. "Fetched" uses the warning status token.
   - When `phaseSumMs ≠ totalMs`, a note reads: "Phases can overlap. Their durations add up to {sum} ms against a total of {total} ms."
4. **First byte.** It shows `latency_ms`, `proxy_latency_ms`, and each `gateway_phases_ms` entry as a small labelled list, when present.
5. **Other frames.** A collapsed `<details>` lists every `otherFrames` entry with its offset, kind and actor, the same information today's list shows.

Behaviour:

- **Structure.** Each tier is a `<table>` with a caption. Labels and numbers are text cells, and bars are `aria-hidden` decorations.
- **Motion.** Bars grow from zero width once, when they first render. Reduced motion skips the animation.
- **Narrow screens.** Below 640px, labels wrap above their bars and the actor column hides.

### 4. Opening a wake

- **The drawer.**
  - `Modal` (`src/components/ui/modal.tsx`) gains `placement?: 'center' | 'right'`, defaulting to `'center'`.
  - `'right'` renders a full-height panel up to 720px wide, full width under 640px, entering from the right.
  - Focus trap, Escape, backdrop close, scroll lock and focus return stay exactly as they are.
- **`WakeDrawer`** (`src/components/dashboard/wake-drawer.tsx`) takes `{ slug, wakeId, onClose }`. It renders `<Modal placement="right" title="Wake">` with the app slug and wake time in its header and `WakeWaterfall` as its body.
- **The URL.**
  - The open wake is a `wake` search param.
  - `validateDebugSearch` in `src/components/dashboard/debug-search.ts` accepts `wake`, a non-empty string. That covers `/dashboard/debug` and `/dashboard/apps/$appSlug`, whose search already spreads it.
  - The analytics route's search validator (`AccountAnalyticsSearch`) accepts `wake` too.
  - Opening pushes a history entry that sets `wake` with `search: (prev) => ({ ...prev, wake })`. Browser Back while the drawer is open removes it and closes the drawer.
  - Closing with Escape, the close button or the backdrop removes `wake` with `replace: true`, so closing never adds a history entry and Back afterwards goes where it would have gone before the drawer opened.
- **Hosts.** Each host mounts one `WakeDrawer` when `wake` is set: the app page, the standalone debugger page and the analytics page. The app's Debugger tab is inside the app page, so it is not a separate host.
- **Entry points.**
  - **Recent wakes panel.** Each `WakeTimelinePanel` row with a `wake_id` becomes a link to the current route with `wake` set. Rows without one stay plain.
  - **Debugger.** In `debug-request-evidence.tsx`, when `data.request.wake_id` is present, the evidence list gains a row labelled "Wake" whose value is a link, "Woke the app · Open wake", that sets `wake`.
  - **Instance detail.** `instance-detail.tsx` renders `WakeWaterfall` inline where `WakeTimeline` is today. There is no drawer, because it is already inside a modal, and `?instance=` already makes it linkable.
- **Unknown or expired wakes.** A 404 or an empty event list shows the empty state inside the drawer: "No frames recorded for this wake. It may have aged out. Check the debugger for request evidence." The host page is unaffected.

### 5. Mock

- **`GET /v1/apps/{slug}/wakes/{wake_id}/timeline`** in `mock/plugin.ts` is rewritten to the canonical vocabulary. Scenarios are picked deterministically from a hash of `wake_id`, so the random IDs on recent-wakes rows each open a stable story:
  - most wakes: a restore, about 300 ms, with load snapshot the largest phase and all artifacts cache hits;
  - a restore with one `materialized` artifact of several hundred MB, the largest phase being resolve images;
  - a cold boot with `wake.cold_boot_breakdown`;
  - a thaw with three generations;
  - a restore that fell back to a cold boot (`restore_fallback_reason: after_restore_failed`);
  - a failed boot with a `reason`;
  - a stalled wake;
  - a legacy frame (`state_transition`) and a `wake.cold_boot_cpu` frame mixed into one scenario, to exercise "Other frames".
- **`MOCK_PLAN=free`** makes the route return the same 402 `plan_per_app_metrics_not_allowed` problem as the per-app route.
- **Debugger evidence** (`GET /v1/apps/{slug}/debug/requests/{req_id}/evidence`) includes `wake_id` on requests with `cold_boot: true`.
- `src/lib/mock-spec-drift.test.ts` stays green: no new paths are added.

## Testing

All tests are written first and watched failing.

- **`src/lib/wake-anatomy.test.ts`**:
  - each method;
  - segment ordering with `readiness_200` before `boot_completed`;
  - a leading queue segment;
  - a skewed timestamp;
  - every outcome and the fallback;
  - thaw generations;
  - `share` and `largest`;
  - `beforeWindow` excluded from `largest`;
  - an overlap where `phaseSumMs > totalMs`;
  - malformed values (string, negative, NaN, missing) dropped;
  - an unknown artifact source;
  - unknown and legacy kinds landing in `otherFrames`;
  - an empty event list.
- **`wake-waterfall.test.tsx`**:
  - the summary sentence and the largest-phase callout;
  - the failure, stall and fallback banners;
  - the artifact chips, including "Fetched";
  - the overlap note, present only when sums differ;
  - the thaw picker, present only with more than one generation;
  - "Other frames";
  - table semantics with an accessible caption;
  - loading, empty and error;
  - the 402 plan gate;
  - "Load older frames" appearing only when `next_cursor` is non-empty.
- **`modal.test.tsx`**: `placement="right"` keeps the focus trap, Escape and focus return.
- **`wake-drawer` and host tests**:
  - a recent-wakes row click sets `?wake=`;
  - Escape and Back close the drawer and remove the param;
  - a deep link opens the drawer;
  - a 404 shows the empty state with the page intact;
  - the analytics page hosts it too.
- **Debugger**: the "Wake" row appears only when `wake_id` is present, and its link sets `wake`.
- **Instance detail**: it renders the waterfall inline.
- **Verification**:
  - `tsc` exits 0;
  - lint has 0 errors and no more than the existing 4 warnings;
  - Prettier is clean;
  - `npx vitest run --maxWorkers=8` exits 0 with no "Errors" line;
  - `npm run build` succeeds;
  - a browser walk of `npm run dev:mock` opens each mock scenario from all three entry points.

## Not in this change

- Per-phase statistics across many wakes (p50, p95). That is a different question, answered by aggregates.
- A target line, such as the published 350 ms restore goal. It is a platform goal, not a per-app promise, and drawing it on every wake would imply one.
- Live updates while a wake is in progress. There is no customer stream for wake events.
- Detail views for `wake.cold_boot_cpu`, `wake.cpu_boost_tail` and park events. They appear under "Other frames".

## Questions for Poyraz

None block the merge.

1. **Contract stability.** The restore keys are called a customer contract in `pkg/fcvm/vmm.go`. Are the `wake.cold_boot_breakdown` and `wake.thaw_breakdown` keys equally stable, or should the console treat them as best-effort? Until he answers, the console reads them defensively either way.
2. **Order and overlap.** Is struct field order the execution order, and which restore phases overlap besides the pre-boot write and the wake network? Until he answers, the console marks overlap generically, using the sum-versus-total check.
   - Related: does `wake.queue_accepted.queue_wait_ms` measure time spent queued before acceptance? The console draws it as a leading "Queued" segment on that assumption.
3. **Plan gate.** The per-wake timeline returns 402 on Free. It is also the only wake evidence in instance detail. Is the gate intended for single wakes, or only for the per-app aggregate?
