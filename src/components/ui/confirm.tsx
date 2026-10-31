import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from './button';
import { Modal } from './modal';

/**
 * One confirm dialog for the whole console, asked for as a promise.
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: 'Delete DATABASE_URL?', destructive: true }))) return;
 *
 * Before this, confirmation existed in exactly two places — the plan switch
 * and the workspace delete — and every other destructive action fired on the
 * first click: secrets, env vars, domains, crons, alerts, edge rules, key
 * revoke and rotate, session revoke, sign-out-everywhere, rollback, replay. A
 * secret is unrecoverable and a revoked key breaks CI instantly; none of them
 * should be one misclick away. The `ConfirmDialog` in modal.tsx was the
 * intended fix and nothing ever imported it, because wiring open/close state
 * into every row is the part people skip. A promise has no state to wire.
 */

export interface ConfirmOptions {
  title: string;
  /** What actually happens — consequences, not a restatement of the title. */
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  /**
   * A phrase the person has to type before the button enables — the app's
   * slug, say. For the handful of actions where a misclick costs a deploy,
   * not a minute.
   */
  typeToConfirm?: string;
}

type Ask = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState('');
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setPending(null);
    setTyped('');
  }, []);

  const armed = !pending?.typeToConfirm || typed === pending.typeToConfirm;

  const ask = useCallback<Ask>(
    (options) =>
      new Promise((resolve) => {
        // A second ask while one is open answers the first with "no" rather
        // than stacking dialogs; the caller that lost is the one that raced.
        resolver.current?.(false);
        resolver.current = resolve;
        setPending(options);
      }),
    []
  );

  const value = useMemo(() => ask, [ask]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Modal
        open={pending !== null}
        onClose={() => settle(false)}
        title={pending?.title ?? ''}
        description={pending?.description}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => settle(false)}>
              Cancel
            </Button>
            <Button
              variant={pending?.destructive ? 'destructive' : 'default'}
              size="sm"
              autoFocus={!pending?.typeToConfirm}
              disabled={!armed}
              onClick={() => armed && settle(true)}
            >
              {pending?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        {pending?.typeToConfirm && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              Type <span className="font-mono text-foreground">{pending.typeToConfirm}</span> to
              confirm
            </span>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && armed && settle(true)}
              spellCheck={false}
              autoComplete="off"
              className="mt-2 h-10 w-full rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus:border-[color:var(--status-critical)]"
            />
          </label>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ask;
}
