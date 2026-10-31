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
