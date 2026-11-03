import { useId, type ReactNode, type Ref } from 'react';
import { NavArrowDown } from 'iconoir-react';
import { cn } from '@/lib/utils';

/** Keep important alternatives visible, with native radio keyboard behavior. */
export function SettingChoices<T extends string>({
  labelId,
  value,
  onChange,
  options,
  disabled = false,
}: {
  labelId: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string; description: string }[];
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-labelledby={labelId} className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm transition-colors has-focus-visible:ring-2 has-focus-visible:ring-brand',
            value === option.value
              ? 'border-brand/50 bg-brand/5'
              : 'border-border hover:bg-muted/40',
            disabled && 'cursor-default opacity-60'
          )}
        >
          <input
            type="radio"
            name={id}
            value={option.value}
            checked={value === option.value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
            aria-labelledby={`${id}-${option.value}-label`}
            aria-describedby={`${id}-${option.value}-hint`}
            className="mt-0.5 size-4 shrink-0 accent-[color:var(--brand)]"
          />
          <span className="flex min-w-0 flex-col gap-1">
            <span id={`${id}-${option.value}-label`} className="font-medium">
              {option.label}
            </span>
            <span
              id={`${id}-${option.value}-hint`}
              className="text-xs leading-relaxed text-muted-foreground"
            >
              {option.description}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

export const APP_ACCESS_OPTIONS = [
  {
    value: 'public',
    label: 'Public URL',
    description: 'Reachable over the internet. Your app controls authentication.',
  },
  {
    value: 'internal',
    label: 'Internal only',
    description: 'Called by apps in your account. No public URL.',
  },
] as const;

/** The actual defaults stay visible even while optional controls are folded away. */
export function AdvancedSettings({
  children,
  summary,
  detailsRef,
}: {
  children: ReactNode;
  summary: ReactNode;
  detailsRef?: Ref<HTMLDetailsElement>;
}) {
  return (
    <details
      ref={detailsRef}
      aria-label="Advanced settings"
      className="group/advanced rounded-xl border border-border bg-card"
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 focus-visible:outline-2 focus-visible:outline-brand [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-medium">Advanced settings</span>
          <span className="text-[13px] leading-5 text-muted-foreground">{summary}</span>
        </span>
        <NavArrowDown
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open/advanced:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="@container flex flex-col divide-y divide-border border-t border-border">
        {children}
      </div>
    </details>
  );
}

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
