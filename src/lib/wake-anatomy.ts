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

/** Frames that begin a wake or a thaw; after a first byte, one opens a new generation. */
const OPENERS = new Set([
  'wake.thaw_breakdown',
  'wake.queue_accepted',
  'wake.admitted',
  'wake.boot_started',
]);

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
  // own first byte. A generation therefore closes at a first byte, but the
  // next one opens only on a frame that starts a wake: schedd stamps
  // boot_completed after publishing RUNNING, so it can trail the first byte
  // and still belongs to the same wake.
  const groups: Item[][] = [];
  let current: Item[] = [];
  let answered = false;
  for (const item of consumed) {
    if (answered && OPENERS.has(item.ev.kind)) {
      groups.push(current);
      current = [];
      answered = false;
    }
    current.push(item);
    if (item.ev.kind === 'wake.proxy_first_byte') answered = true;
  }
  if (current.length) groups.push(current);

  return { generations: groups.map(buildGeneration), otherFrames };
}
