import { cellState, type CellState, type EnvDiffRow } from '@/lib/env-diff';
import { cn } from '@/lib/utils';

const GLYPH: Record<CellState, string> = { missing: '—', same: '●', differs: '◐', only: '○' };
const TONE: Record<CellState, string> = {
  missing: 'text-[color:var(--status-critical)]',
  same: 'text-[color:var(--status-good)]',
  differs: 'text-[color:var(--status-warning)]',
  only: 'text-muted-foreground',
};

/**
 * `gregale env diff`: presence and value-equality of every key across scopes,
 * without ever showing a value. ● identical everywhere, ◐ present but
 * different, ○ set in this scope alone, — missing here.
 */
export function EnvDiffMatrix({ scopes, rows }: { scopes: string[]; rows: EnvDiffRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th scope="col" className="label-mono py-1 text-left text-muted-foreground">
              Key
            </th>
            {scopes.map((s) => (
              <th key={s} scope="col" className="label-mono py-1 text-center text-muted-foreground">
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border">
              <td className="py-1 font-mono text-xs">
                {r.key}
                {r.kind === 'secret' && <span className="ml-1 text-muted-foreground">·secret</span>}
              </td>
              {scopes.map((s) => {
                const st = cellState(r, s);
                return (
                  <td
                    key={s}
                    className={cn('py-1 text-center font-mono', TONE[st])}
                    aria-label={`${r.key} in ${s}: ${st}`}
                    title={st}
                  >
                    {GLYPH[st]}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">
        ● identical · ◐ differs · ○ only here · — missing
      </p>
    </div>
  );
}
