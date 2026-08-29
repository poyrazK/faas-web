import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, Copy } from 'iconoir-react';
import { cn } from '@/lib/utils';

/**
 * One copy-to-clipboard vocabulary for the whole app.
 *
 * The confirmation lives where the press happened — the icon springs into a
 * check for a couple of seconds — because the reader is looking at the button
 * when they press it, and a toast is chrome the moment does not need. Four
 * components used to hand-roll this state machine separately; the hook and
 * the morph are those four, folded into one.
 */

/** Copied-state machine: clipboard write, a reset timer, unmount cleanup.
 * `copy` resolves false when clipboard access is denied or absent (plain
 * http, permissions policy) so callers can report or ignore it. */
export function useCopy(resetMs = 2000) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return false;
      }
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), resetMs);
      return true;
    },
    [resetMs]
  );

  return { copied, copy };
}

/** The icon half of the interaction: Copy springs into Check and back.
 * Purely decorative — pair it with visible text or an aria-live region.
 * Sized by the caller via `className` (defaults to the console's 3.5). */
export function CopyMorph({ copied, className }: { copied: boolean; className?: string }) {
  const reduce = useReducedMotion();
  const spring = { type: 'spring', stiffness: 500, damping: 30 } as const;
  return (
    <span aria-hidden className={cn('relative inline-flex h-3.5 w-3.5 shrink-0', className)}>
      <AnimatePresence initial={false}>
        {copied ? (
          <motion.span
            key="check"
            className="absolute inset-0"
            initial={reduce ? false : { scale: 0.4, opacity: 0, rotate: -30 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { scale: 0.4, opacity: 0 }}
            transition={spring}
          >
            <Check className="h-full w-full" />
          </motion.span>
        ) : (
          <motion.span
            key="copy"
            className="absolute inset-0"
            initial={reduce ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { scale: 0.6, opacity: 0 }}
            transition={spring}
          >
            <Copy className="h-full w-full" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** Compact icon-only copy control for tight chrome — code rows, list items.
 * Carries its own announced state; `label` names what is being copied. */
export function CopyIconButton({
  text,
  label,
  className,
}: {
  text: string;
  /** Accessible name, e.g. the command being copied. */
  label: string;
  className?: string;
}) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      aria-label={`Copy: ${label}`}
      onClick={() => void copy(text)}
      className={cn(
        'pressable flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
        copied
          ? 'bg-brand-muted text-brand'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        className
      )}
    >
      <CopyMorph copied={copied} />
      <span aria-live="polite" className="sr-only">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  );
}
