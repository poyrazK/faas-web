import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Copy, WarningTriangle } from 'iconoir-react';
import { cn } from '@/lib/utils';

export const INSTALL_COMMAND = 'npm install -g gregale';
const FILL_EASE = [0.22, 1, 0.36, 1] as const;
const HOLD_MS = 2400;
type CopyState = 'idle' | 'copying' | 'copied' | 'error';

/** Same feedback for the hero's joined pill and the footer's standalone pill. */
export function InstallCommand({
  className,
  variant = 'standalone',
}: {
  className?: string;
  variant?: 'inline' | 'standalone';
}) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  const pending = useRef(false);
  const reduce = useReducedMotion();
  const copied = state === 'copied';

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = async () => {
    if (pending.current) return;
    pending.current = true;
    if (timer.current) clearTimeout(timer.current);
    setState('copying');
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      if (!mounted.current) return;
      setState('copied');
      timer.current = setTimeout(() => setState('idle'), HOLD_MS);
    } catch {
      if (mounted.current) setState('error');
    } finally {
      pending.current = false;
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy install command: ${INSTALL_COMMAND}`}
      aria-busy={state === 'copying'}
      data-copy-state={state}
      title={state === 'error' ? 'Couldn’t copy. Select the command or try again.' : undefined}
      className={cn(
        'group relative isolate flex min-w-0 cursor-pointer items-center overflow-hidden rounded-full text-left font-mono text-sm outline-none transition-[box-shadow,border-color] duration-300 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none',
        variant === 'inline'
          ? 'h-12 flex-1 pl-5 pr-3 text-foreground/80 hover:text-foreground'
          : 'h-11 border border-border bg-card/70 pl-5 pr-2 text-muted-foreground backdrop-blur-sm hover:border-brand/40 hover:text-foreground',
        copied && 'shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--brand-fill)_35%,transparent)]',
        className
      )}
    >
      {/* A rounded advancing edge fills from the copy icon across the pill. */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.65),inset_0_-1px_0_rgba(0,72,42,0.08)]"
        style={{
          background:
            'linear-gradient(105deg, var(--mint-6), var(--mint-7) 60%, var(--brand-fill))',
        }}
        initial={false}
        animate={{
          clipPath: copied ? 'inset(0% 0% 0% 0% round 999px)' : 'inset(0% 0% 0% 100% round 999px)',
        }}
        transition={{ duration: reduce ? 0 : copied ? 0.56 : 0.42, ease: FILL_EASE }}
      >
        {copied && !reduce && (
          <motion.span
            className="absolute inset-0 bg-[linear-gradient(110deg,transparent_30%,rgba(255,255,255,0.4)_50%,transparent_70%)]"
            initial={{ x: '110%' }}
            animate={{ x: '-110%' }}
            transition={{ duration: 0.85, delay: 0.08, ease: FILL_EASE }}
          />
        )}
      </motion.span>

      {/* Keep the command in flow, fixing the pill's dimensions during feedback. */}
      <motion.span
        aria-hidden
        className="relative z-10 flex min-w-0 flex-1 items-center gap-3"
        initial={false}
        animate={{
          opacity: copied ? 0 : 1,
          y: reduce ? 0 : copied ? -4 : 0,
          filter: reduce || !copied ? 'blur(0px)' : 'blur(3px)',
        }}
        transition={{ duration: reduce ? 0 : 0.2, delay: !copied && !reduce ? 0.12 : 0 }}
      >
        <span className="text-brand">$</span>
        <span className="truncate tracking-tight">{INSTALL_COMMAND}</span>
        <span
          className={cn(
            'ml-auto flex size-7 shrink-0 items-center justify-center rounded-full',
            variant === 'inline' ? 'bg-background/70' : 'bg-muted group-hover:bg-secondary',
            state === 'error' ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {state === 'error' ? (
            <WarningTriangle className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </span>
      </motion.span>

      <AnimatePresence initial={false}>
        {copied && (
          <motion.span
            key="confirmation"
            aria-hidden
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center gap-2 font-sans text-[15px] font-semibold tracking-[-0.02em] text-primary-foreground"
            initial={{
              opacity: reduce ? 1 : 0,
              y: reduce ? 0 : 5,
              filter: reduce ? 'blur(0px)' : 'blur(3px)',
            }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: reduce ? 0 : -3, transition: { duration: reduce ? 0 : 0.12 } }}
            transition={{ duration: reduce ? 0 : 0.28, delay: reduce ? 0 : 0.16, ease: FILL_EASE }}
          >
            <svg viewBox="0 0 20 20" fill="none" className="size-[18px]">
              <motion.path
                d="M4 10.5 8 14.5 16 6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: reduce ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={{
                  duration: reduce ? 0 : 0.28,
                  delay: reduce ? 0 : 0.2,
                  ease: FILL_EASE,
                }}
              />
            </svg>
            Copied
          </motion.span>
        )}
      </AnimatePresence>
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {copied
          ? 'Copied to clipboard'
          : state === 'error'
            ? 'Couldn’t copy. Select the command or try again.'
            : state === 'copying'
              ? 'Copying command'
              : ''}
      </span>
    </button>
  );
}
