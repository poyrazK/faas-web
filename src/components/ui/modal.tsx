import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Xmark } from 'iconoir-react';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { EASE } from '@/components/dashboard/motion';

/**
 * Dialog primitive. Locks page scroll, closes on Escape or backdrop click,
 * traps focus while open and restores it on close.
 *
 * Portalled to `document.body`: a dialog rendered in the calling tree breaks
 * the moment any ancestor has `overflow: hidden`, a transform, or its own
 * stacking context — Panel, for one, has all three candidates. The `.console`
 * class is mirrored onto `<html>` by the shell, so tokens still resolve.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const descriptionId = useId();
  // Focus in on open, Tab wraps inside, focus restored on close.
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  // The prerender step server-renders the public routes (and the providers
  // above them). A dialog is interactive chrome with no crawler value, so on
  // the server this renders nothing rather than reaching for a document that
  // does not exist there.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
          <motion.button
            aria-label="Close dialog"
            tabIndex={-1}
            onClick={onClose}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: reduce ? 0 : 0.12 } }}
            transition={{ duration: reduce ? 0 : 0.15 }}
            className="absolute inset-0 bg-mint-12/35 backdrop-blur-sm"
          />

          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            aria-describedby={description ? descriptionId : undefined}
            initial={reduce ? false : { opacity: 0, scale: 0.98, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={
              reduce
                ? { opacity: 0, transition: { duration: 0 } }
                : {
                    opacity: 0,
                    scale: 0.98,
                    y: -6,
                    transition: { duration: 0.12, ease: EASE },
                  }
            }
            transition={{ duration: reduce ? 0 : 0.18, ease: EASE }}
            className={`relative w-full ${width} overflow-hidden rounded-xl border border-border bg-popover shadow-elevation-3 outline-none`}
          >
            <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
                {description && (
                  <p
                    id={descriptionId}
                    className="mt-1 text-xs leading-relaxed text-muted-foreground"
                  >
                    {description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="pressable -mr-1 -mt-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Xmark className="h-3.5 w-3.5" />
              </button>
            </header>

            {children && <div className="px-5 py-4">{children}</div>}

            {footer && (
              <footer className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
                {footer}
              </footer>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
