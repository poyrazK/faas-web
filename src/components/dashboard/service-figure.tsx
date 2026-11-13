import type { ReactNode } from 'react';

/** One figure in a compact service block. */
export function ServiceFigure({
  label,
  value,
  note,
  extra,
}: {
  label: string;
  value: string;
  note?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1 text-sm font-medium [font-variant-numeric:tabular-nums]">
        <span>{value}</span>
        {extra}
      </dd>
      {note && (
        <dd className="text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
          {note}
        </dd>
      )}
    </div>
  );
}
