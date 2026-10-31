import { useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ *
 * Two switchers, one rule.
 *
 * - **Tabs** (underline) choose which page of a page you are on. They are
 *   navigation: one strip per page, the choice lives in the URL, and the
 *   selected item carries `aria-current="page"` (or `aria-selected` for an
 *   in-page tablist).
 * - **Segments** (a pill group) switch a view *inside* a panel — a direction,
 *   a scope, a filter, a range. Several can sit on one page, and the selected
 *   item carries `aria-pressed`.
 *
 * The console used to have six looks for these two jobs — muted pills, outline
 * buttons, bordered links, solid buttons — so the same control read as a
 * filter on one page and as navigation on the next. Everything that switches
 * goes through here now; a new look means changing it here, once.
 * ------------------------------------------------------------------ */

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

/** Class for one underline tab. For `Link`s and buttons alike. */
export function tabClassName(active: boolean, className?: string) {
  return cn(
    'pressable -mb-px whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm',
    FOCUS,
    active
      ? 'border-brand font-medium text-foreground'
      : 'border-transparent text-muted-foreground hover:text-foreground',
    className
  );
}

/** The strip that holds underline tabs. Route tabs render `Link`s inside. */
export function TabNav({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn('flex flex-wrap gap-1 border-b border-border', className)}
    >
      {children}
    </nav>
  );
}

/**
 * In-page tabs: a real `tablist` with roving focus and arrow-key movement, for
 * a choice that swaps the panel beneath it. The caller owns the panel and
 * labels it with `tabId(panelId, key)`.
 */
export function Tabs<T extends string>({
  label,
  value,
  options,
  onChange,
  panelId,
  className,
}: {
  label: string;
  value: T;
  options: readonly { key: T; label: string }[];
  onChange: (key: T) => void;
  panelId: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn('flex flex-wrap gap-1 border-b border-border', className)}
    >
      {options.map((option, index) => {
        const active = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            role="tab"
            id={tabId(panelId, option.key)}
            ref={(el) => {
              refs.current[index] = el;
            }}
            aria-selected={active}
            aria-controls={panelId}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.key)}
            onKeyDown={(event) => {
              const next = rovingIndex(event.key, index, options.length);
              if (next === null) return;
              event.preventDefault();
              refs.current[next]?.focus();
              onChange(options[next].key);
            }}
            className={tabClassName(active)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function tabId(panelId: string, key: string) {
  return `${panelId}-tab-${key.replace(/\s+/g, '-')}`;
}

function rovingIndex(key: string, index: number, length: number): number | null {
  if (key === 'ArrowRight') return (index + 1) % length;
  if (key === 'ArrowLeft') return (index + length - 1) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return null;
}

/** Class for one segment. For `Link`s and buttons alike. */
export function segmentClassName(active: boolean, className?: string) {
  return cn(
    'pressable whitespace-nowrap rounded px-2.5 py-1 text-xs disabled:opacity-50',
    FOCUS,
    active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
    className
  );
}

/** The frame around segments. `nav` when the segments are links. */
export function SegmentGroup({
  label,
  children,
  as = 'div',
  className,
}: {
  label: string;
  children: ReactNode;
  as?: 'div' | 'nav';
  className?: string;
}) {
  const Frame = as;
  return (
    <Frame
      {...(as === 'div' ? { role: 'group' } : {})}
      aria-label={label}
      className={cn('flex w-fit flex-wrap rounded-md border border-border p-0.5', className)}
    >
      {children}
    </Frame>
  );
}

/** A segmented control over local state. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className,
}: {
  label: string;
  value: T;
  options: readonly { key: T; label: ReactNode }[];
  onChange: (key: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <SegmentGroup label={label} className={className}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          disabled={disabled}
          aria-pressed={option.key === value}
          onClick={() => onChange(option.key)}
          className={segmentClassName(option.key === value)}
        >
          {option.label}
        </button>
      ))}
    </SegmentGroup>
  );
}
