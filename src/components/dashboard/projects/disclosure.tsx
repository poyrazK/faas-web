import { useId, useState, type ReactNode } from 'react';
import { NavArrowDown } from 'iconoir-react';
import { cn } from '@/lib/utils';

/**
 * Detail on request, at section size: a row that names what is behind it,
 * says in one line what that is for, and opens it in place.
 *
 * Closed, the body is not mounted, so whatever it reads is not fetched until
 * someone asks. Only the chevron moves: the console does not animate content
 * into place (index.css), and a section someone asked for should be readable
 * the moment it opens. The row-sized "Show …" toggle is `Disclosure` in
 * settings-kit.
 */
export function DisclosureSection({
  title,
  hint,
  defaultOpen = false,
  children,
  className,
}: {
  title: string;
  /** One plain line saying what is inside, shown under the title. */
  hint?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className={cn('flex flex-col gap-4', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="surface pressable flex min-h-14 w-full items-center gap-3 rounded-[1.25rem] bg-card px-5 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-semibold tracking-[-0.01em]">{title}</span>
          {hint && <span className="text-[13px] leading-5 text-muted-foreground">{hint}</span>}
        </span>
        <NavArrowDown
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-(--motion-ease) motion-reduce:transition-none',
            open && 'rotate-180'
          )}
        />
      </button>
      {open && (
        <div id={id} className="flex flex-col gap-6">
          {children}
        </div>
      )}
    </section>
  );
}
