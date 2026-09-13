import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Plus, Xmark } from 'iconoir-react';
import { Button } from './button';

/** Close unmounts immediately: an exit animation must never retain secret evidence. */
export function ActionDisclosure({
  action,
  title,
  open,
  onOpenChange,
  disabled,
  children,
}: {
  action: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const region = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  useLayoutEffect(() => {
    if (open) {
      const first =
        region.current?.querySelector<HTMLElement>('input, select, textarea') ??
        region.current?.querySelector<HTMLElement>('button');
      first?.focus();
    }
  }, [open]);

  function close() {
    onOpenChange(false);
    trigger.current?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <Button
        ref={trigger}
        type="button"
        size="sm"
        className="self-start gap-1.5"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={() => (open ? close() : onOpenChange(true))}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {action}
      </Button>
      {open && (
        <motion.section
          ref={region}
          id={id}
          aria-labelledby={`${id}-title`}
          initial={reduce ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0 : 0.18 }}
          className="rounded-xl border border-border bg-card p-5"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.defaultPrevented) {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id={`${id}-title`} className="label-mono text-foreground">
              {title}
            </h2>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Close ${title}`}
              onClick={close}
            >
              <Xmark className="h-4 w-4" aria-hidden />
              Close
            </Button>
          </div>
          {children}
        </motion.section>
      )}
    </div>
  );
}
