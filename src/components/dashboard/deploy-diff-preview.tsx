import { WarningCircle, WarningTriangle } from 'iconoir-react';
import type { components } from '@/lib/api/schema';
import { CliCommand } from './cli-command';

type DiffResponse = components['schemas']['DiffResponse'];
type DiffBreak = DiffResponse['diff']['breaks'][number];

/**
 * The engine re-emits before/after/observed/limit as whatever the field holds
 * — a number, a string, a list or a struct (DiffChange, DiffBreak) — so each
 * is printed as itself, never through String() on an object.
 */
export function diffValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) return value.map(diffValue).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const SEVERITY: Record<
  DiffBreak['severity'],
  { label: string; color: string; Icon: typeof WarningTriangle }
> = {
  error: { label: 'Blocks the deploy', color: 'var(--status-critical)', Icon: WarningTriangle },
  warn: { label: 'Warning', color: 'var(--status-warning)', Icon: WarningCircle },
};

/**
 * What POST /v1/apps/{slug}/diff says a proposed change would do: the same
 * engine and wire shape as `gregale deploy --server-diff` (faas
 * apidserver/handlers_diff.go). Read-only — nothing is written. A break with
 * severity `error` makes the response `blocking`: the deploy path would
 * refuse it with that code.
 */
export function DeployDiffPreview({ preview }: { preview: DiffResponse }) {
  const changes = preview.diff.changes ?? [];
  const breaks = preview.diff.breaks ?? [];
  return (
    <div className="flex flex-col gap-4">
      {changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No effective changes.</p>
      ) : (
        <ul aria-label="Changes" className="flex flex-col divide-y divide-border">
          {changes.map((c) => (
            <li
              key={`${c.kind}:${c.field}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-xs"
            >
              <span className="w-44 max-w-full shrink-0 font-mono [overflow-wrap:anywhere]">
                {c.field}
              </span>
              <span className="text-muted-foreground line-through [overflow-wrap:anywhere]">
                {diffValue(c.before)}
              </span>
              <span aria-hidden className="text-muted-foreground/50">
                →
              </span>
              <span className="text-foreground [overflow-wrap:anywhere]">{diffValue(c.after)}</span>
            </li>
          ))}
        </ul>
      )}
      {breaks.length > 0 && (
        <div>
          <p className="label-mono mb-1.5 text-muted-foreground">What it would break</p>
          <ul aria-label="What it would break" className="flex flex-col gap-2">
            {breaks.map((b) => {
              const view = SEVERITY[b.severity] ?? SEVERITY.warn;
              return (
                <li key={`${b.code}:${b.field ?? ''}`} className="flex gap-2 text-xs">
                  <view.Icon
                    aria-hidden
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    style={{ color: view.color }}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span>
                      <span style={{ color: view.color }}>{view.label}</span>{' '}
                      <code className="font-mono">{b.code}</code>
                    </span>
                    <span>{b.reason}</span>
                    {(b.field || b.observed !== undefined || b.limit !== undefined) && (
                      <span className="text-muted-foreground [overflow-wrap:anywhere]">
                        {b.field && <span className="font-mono">{b.field}</span>}
                        {b.observed !== undefined && b.limit !== undefined
                          ? `${b.field ? ': ' : ''}${diffValue(b.observed)} against a limit of ${diffValue(b.limit)}`
                          : ''}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {preview.blocking && (
        <p className="text-xs" style={{ color: 'var(--status-critical)' }}>
          This change is blocking: the deploy would be refused with the first code above.
        </p>
      )}
      <CliCommand
        command="gregale deploy --server-diff"
        label="The CLI runs the same check before a deploy"
        copyLabel="server diff command"
      />
    </div>
  );
}
