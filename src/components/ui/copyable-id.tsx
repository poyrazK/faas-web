import { CopyIconButton } from '@/components/ui/copy-button';
import { cn } from '@/lib/utils';

/** IDs longer than this are shortened unless `displayLength` says otherwise. */
const SHORTEN_ABOVE = 16;
const DEFAULT_DISPLAY = 12;

/**
 * An identifier the reader will paste into the CLI or a support ticket.
 *
 * Long IDs are shortened so a table row stays one line, but the full value
 * is always in `title` and is always what the copy button copies — a
 * truncated ID with no way to get the rest is the thing this replaces.
 */
export function CopyableId({
  value,
  label,
  full = false,
  displayLength,
  className,
}: {
  value: string;
  /** What the ID is, e.g. "bucket ID". Names the copy button. */
  label: string;
  /** Show the whole value. */
  full?: boolean;
  /** Show this many characters then an ellipsis, whenever the value is longer. */
  displayLength?: number;
  className?: string;
}) {
  const limit = displayLength ?? SHORTEN_ABOVE;
  const keep = displayLength ?? DEFAULT_DISPLAY;
  const shown = !full && value.length > limit ? `${value.slice(0, keep)}…` : value;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      <span title={value} className={cn('font-mono text-xs', full ? 'break-all' : 'truncate')}>
        {shown}
      </span>
      {/* The click shield covers the button only: copying inside a clickable
          row must not also open it, but the ID text is part of the row. */}
      <span
        className="inline-flex shrink-0"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <CopyIconButton text={value} label={`${label} ${value}`} />
      </span>
    </span>
  );
}
