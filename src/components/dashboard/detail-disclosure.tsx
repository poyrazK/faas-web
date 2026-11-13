import { useId, useState, type ReactNode } from 'react';
import { NavArrowRight } from 'iconoir-react';

/**
 * Detail on request (docs/console-plain-english.md rule 4): a quiet
 * "▸ Title · summary" line that opens what is behind it. The contents mount
 * only while open, so a closed section reads nothing and costs nothing.
 */
export function DetailDisclosure({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** A few plain words saying what is inside, shown while closed. */
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="pressable inline-flex min-w-0 items-baseline gap-2 self-start rounded text-left text-sm text-foreground/80 hover:text-foreground"
      >
        <NavArrowRight
          aria-hidden
          className={`size-3.5 shrink-0 translate-y-0.5 transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
        />
        <span className="font-medium">{title}</span>
        {summary && !open && (
          <span className="hidden text-muted-foreground sm:inline">{summary}</span>
        )}
      </button>
      <div id={id} hidden={!open} className="pl-5.5">
        {open && children}
      </div>
    </div>
  );
}
