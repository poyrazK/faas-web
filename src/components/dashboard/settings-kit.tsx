import { useId, useState, type ReactNode } from 'react';
import { NavArrowRight } from 'iconoir-react';
import { cn } from '@/lib/utils';
import type { Tone } from './app-settings-words';

const TONE: Record<Tone, string> = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
  neutral: 'var(--muted-foreground)',
};

/**
 * Rule 1 for a settings tab: what is set now, in one sentence set larger than
 * everything else, with a few short facts after it.
 */
export function SettingsSummary({
  label,
  tone = 'neutral',
  children,
  facts = [],
  actions,
  ariaLabel = 'What is set now',
}: {
  label: string;
  tone?: Tone;
  children: ReactNode;
  facts?: string[];
  actions?: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <section
      aria-label={ariaLabel}
      className="well flex flex-wrap items-start justify-between gap-x-6 gap-y-4 rounded-2xl bg-muted/40 px-5 py-5 sm:px-6"
    >
      <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
        <span className="bento-label flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={
              tone === 'neutral'
                ? { boxShadow: `inset 0 0 0 1.5px ${TONE.neutral}` }
                : { backgroundColor: TONE[tone] }
            }
          />
          {label}
        </span>
        <p className="text-xl leading-7 font-medium tracking-[-0.01em] text-balance [overflow-wrap:anywhere]">
          {children}
        </p>
        {facts.length > 0 && <p className="text-sm text-muted-foreground">{facts.join(' · ')}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </section>
  );
}

/** "Show …" disclosure: a quiet button that reveals what most people never need. */
export function Disclosure({
  label,
  defaultOpen = false,
  forceOpen = false,
  children,
  className,
}: {
  label: string;
  defaultOpen?: boolean;
  /** Held open, e.g. while a field inside it has an error. */
  forceOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const shown = open || forceOpen;
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <button
        type="button"
        aria-expanded={shown}
        aria-controls={id}
        onClick={() => setOpen(!shown)}
        className="pressable inline-flex items-center gap-2 self-start rounded text-sm text-foreground/75 hover:text-foreground"
      >
        <NavArrowRight
          aria-hidden
          className={`size-3.5 transition-transform duration-150 motion-reduce:transition-none ${shown ? 'rotate-90' : ''}`}
        />
        {label}
      </button>
      {shown && (
        <div id={id} className="flex flex-col gap-5">
          {children}
        </div>
      )}
    </div>
  );
}

/** A row of plain-labelled choices; the exact value stays in each one's `title`. */
export function ChoiceButtons<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          title={option.title ?? option.value}
          onClick={() => onChange(option.value)}
          className={`pressable h-9 rounded-md border px-3 text-sm ${
            value === option.value
              ? 'border-brand bg-brand/10 text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
