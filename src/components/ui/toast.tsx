import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { WarningTriangle, CheckCircle, InfoCircle, Xmark } from 'iconoir-react';
import { EASE } from '@/components/dashboard/motion';

type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

/** Errors linger — they usually carry something the user has to act on. */
const DISMISS_MS: Record<ToastKind, number> = {
  success: 5000,
  info: 5000,
  error: 9000,
};

const KIND = {
  success: { icon: CheckCircle, color: 'var(--status-good)' },
  error: { icon: WarningTriangle, color: 'var(--status-critical)' },
  info: { icon: InfoCircle, color: 'var(--brand)' },
} as const;

const ToastContext = createContext<{
  toast: (t: Omit<Toast, 'id'>) => void;
} | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const reduce = useReducedMotion();

  // Auto-dismiss timers, tracked so a provider that unmounts with toasts
  // still on screen does not fire setState into a torn-down tree.
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { ...t, id }]);
    const timer = setTimeout(() => {
      timers.current.delete(id);
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, DISMISS_MS[t.kind]);
    timers.current.set(id, timer);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* No live region on the container: each toast carries its own role, so
          an error interrupts (`alert`) while a success waits its turn
          (`status`). A wrapping `aria-live` on top of those would announce
          every toast twice. */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const { icon: Icon, color } = KIND[t.kind];
            return (
              <motion.div
                key={t.id}
                role={t.kind === 'error' ? 'alert' : 'status'}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={
                  reduce
                    ? { opacity: 0, transition: { duration: 0 } }
                    : { opacity: 0, x: 16, scale: 0.97 }
                }
                transition={{ duration: reduce ? 0 : 0.22, ease: EASE }}
                className="pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-xl border border-border bg-popover/95 p-3.5 shadow-elevation-3 backdrop-blur-sm"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t.title}</p>
                  {t.description && (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {t.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => dismiss(t.id)}
                  className="pressable shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <Xmark className="h-3.5 w-3.5" />
                </button>
                {/* Dwell bar — how long the toast has left, so a 9s error
                    reads as "still here on purpose" rather than stuck. Runs
                    on the same clock as the dismiss timer; decorative, so
                    hidden from AT and dropped under reduced motion. */}
                {!reduce && (
                  <motion.span
                    aria-hidden
                    initial={{ scaleX: 1 }}
                    animate={{ scaleX: 0 }}
                    transition={{ duration: DISMISS_MS[t.kind] / 1000, ease: 'linear' }}
                    className="absolute inset-x-0 bottom-0 h-0.5 origin-left"
                    style={{ background: `color-mix(in oklab, ${color} 45%, transparent)` }}
                  />
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
