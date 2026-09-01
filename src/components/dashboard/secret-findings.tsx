import type { SecretFinding } from '@/lib/secret-scan';

/**
 * The CLI prints these to stderr before packing and refuses in `block` mode.
 * Here the person sees the keys (never the values), and the save button
 * stays off until they tick that they meant it — env vars are the right
 * place for a live key, but a pasted `.env` is also how they leak.
 */
export function SecretFindings({
  findings,
  acknowledged,
  onAcknowledge,
}: {
  findings: SecretFinding[];
  acknowledged: boolean;
  onAcknowledge: (ok: boolean) => void;
}) {
  if (findings.length === 0) return null;
  const high = findings.some((f) => f.severity === 'high');
  return (
    <div
      className="rounded-md border p-3 text-sm"
      style={{
        borderColor: 'color-mix(in oklab, var(--status-warning) 40%, transparent)',
        background: 'color-mix(in oklab, var(--status-warning) 6%, transparent)',
      }}
    >
      <p className="mb-2 font-medium">
        {findings.length === 1
          ? 'One value looks like a credential'
          : `${findings.length} values look like credentials`}
      </p>
      <ul className="mb-3 flex flex-col gap-1">
        {findings.map((f) => (
          <li key={f.key} className="flex items-center gap-2 font-mono text-xs">
            <span>{f.key}</span>
            <span className="text-muted-foreground">
              {f.provider} · {f.severity}
            </span>
          </li>
        ))}
      </ul>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => onAcknowledge(e.target.checked)}
        />
        {high ? 'These are meant to be stored here as live credentials.' : 'Store them anyway.'}
      </label>
    </div>
  );
}
