import type { paths } from '@/lib/api/schema';
import { cn } from '@/lib/utils';

type StagesResponse =
  paths['/v1/deployments/{id}/stages']['get']['responses'][200]['content']['application/json'];
export type Stage = NonNullable<StagesResponse['current']>;

/** The closed six-stage vocabulary (ADR-117), in pipeline order. */
export const STAGES: Stage[] = [
  'source_download',
  'dependency_restore',
  'image_build',
  'security_scan',
  'snapshot_prepare',
  'readiness',
];

export const STAGE_LABEL: Record<Stage, string> = {
  source_download: 'Source download',
  dependency_restore: 'Dependency restore',
  image_build: 'Image build',
  security_scan: 'Security scan',
  snapshot_prepare: 'Snapshot prepare',
  readiness: 'Readiness',
};

function duration(ms?: number) {
  if (ms == null) return '';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

/**
 * The deployment pipeline as the server recorded it, not as the UI guessed
 * it: the console used to derive three steps from `status`, so a deploy
 * stuck in the security scan looked like a build.
 */
export function StageTimeline({ stages }: { stages: StagesResponse }) {
  const done = new Map((stages.history ?? []).map((h) => [h.name, h]));
  return (
    <ol className="flex flex-col divide-y divide-border">
      {STAGES.map((name) => {
        const h = done.get(name);
        const current = stages.current === name && !h;
        const tone =
          h?.status === 'failed'
            ? 'text-[color:var(--status-critical)]'
            : h
              ? 'text-[color:var(--status-good)]'
              : current
                ? 'text-brand'
                : 'text-muted-foreground';
        return (
          <li
            key={name}
            aria-current={current ? 'step' : undefined}
            className="flex flex-col gap-0.5 py-2"
          >
            <div className="flex items-center gap-3 text-sm">
              <span aria-hidden className={cn('size-2 rounded-full bg-current', tone)} />
              <span className={cn('flex-1', !h && !current && 'text-muted-foreground')}>
                {STAGE_LABEL[name]}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {current ? 'running' : duration(h?.duration_ms)}
              </span>
            </div>
            {h?.status === 'failed' && h.reason && (
              <p className="pl-5 font-mono text-xs text-muted-foreground">{h.reason}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
