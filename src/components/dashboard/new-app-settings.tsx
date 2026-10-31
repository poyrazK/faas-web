import type { ReactNode } from 'react';

/**
 * New app's settings, in the source list's language: a quiet heading over one
 * rounded card, a row per setting. A row names its setting and says what it
 * does on the left, and holds the control on the right; the two stack when
 * the card is narrow.
 */
export function SettingsSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-sm font-medium text-muted-foreground">
        {title}
      </h2>
      <div className="@container flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
        {children}
      </div>
    </section>
  );
}

export function SettingRow({
  label,
  htmlFor,
  labelId,
  hint,
  hintId,
  children,
}: {
  label: string;
  /** The control this row labels; omit for a group, named by `labelId`. */
  htmlFor?: string;
  labelId?: string;
  hint?: ReactNode;
  hintId?: string;
  children: ReactNode;
}) {
  const Label = htmlFor ? 'label' : 'span';
  return (
    <div className="grid gap-x-8 gap-y-3 px-4 py-4 @xl:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] @xl:items-start">
      <div className="flex min-w-0 flex-col gap-1">
        <Label id={labelId} htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </Label>
        {hint && (
          <p id={hintId} className="text-[13px] leading-5 text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">{children}</div>
    </div>
  );
}
