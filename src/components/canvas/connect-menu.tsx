import { useEffect, useRef } from 'react';
import { Globe, HardDrive, Timer } from 'iconoir-react';
import { cn } from '@/lib/utils';
import { CREATE_OPTIONS, type CreateKind } from './create';
import type { ConnectSide } from './nodes';
import type { Point } from './layout';
import type { AppData } from './topology';

const ICON = { domain: Globe, cron: Timer, bucket: HardDrive } as const;
const TINT = {
  domain: 'var(--cat-network)',
  cron: 'var(--cat-compute)',
  bucket: 'var(--cat-storage)',
} as const;

function disabledReason(kind: CreateKind, app: AppData): string | undefined {
  if (kind !== 'bucket') return;
  if (app.connections === 'error') return 'Storage unavailable';
  if (!app.buckets) return 'Checking storage…';
  if (!app.buckets.enabled) return 'Object storage is not enabled for this account.';
  if (app.buckets.atLimit) return 'This app is at its bucket limit.';
}

/**
 * The directional "+" menu. Focus lands on the first choice once, when the
 * menu opens, and is never taken back on a re-render: a background refresh
 * must not move the user's place. Listeners read the latest props through a
 * ref for the same reason.
 */
export function ConnectMenu({
  app,
  side,
  at,
  onPick,
  onClose,
  onRetry,
}: {
  app: AppData;
  side: ConnectSide;
  at: Point;
  onPick: (kind: CreateKind) => void;
  onClose: () => void;
  onRetry?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const options = CREATE_OPTIONS[side];
  const latest = useRef({ app, onPick, onClose, options });
  useEffect(() => {
    latest.current = { app, onPick, onClose, options };
  });

  useEffect(() => {
    ref.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const items = () => [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
        []),
    ];
    const onKey = (e: KeyboardEvent) => {
      const { app, onPick, onClose, options } = latest.current;
      if (e.key === 'Escape') return onClose();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = items();
        if (!list.length) return;
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        list[(i + step + list.length) % list.length]?.focus({ preventScroll: true });
        return;
      }
      const hit = options.find(
        (o) => o.key === e.key.toLowerCase() && !disabledReason(o.kind, app)
      );
      if (hit) onPick(hit.kind);
    };
    const onDown = (e: PointerEvent) =>
      !ref.current?.contains(e.target as Node) && latest.current.onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, []);

  const heading = side === 'in' ? `Send traffic into ${app.slug}` : `Connect ${app.slug} to`;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={heading}
      className="nodrag nopan absolute z-10 w-[264px] animate-item-enter rounded-xl border border-border bg-popover p-1.5 shadow-elevation-3"
      style={{ transform: `translate(${at.x}px, ${at.y}px)` }}
    >
      <p className="px-2 pt-1.5 pb-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">
        {heading}
      </p>
      {options.map((o) => {
        const Icon = ICON[o.kind];
        const reason = disabledReason(o.kind, app);
        return (
          <button
            key={o.kind}
            type="button"
            role="menuitem"
            disabled={Boolean(reason)}
            onClick={() => onPick(o.kind)}
            className={cn(
              'flex h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left',
              'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50'
            )}
          >
            <span
              aria-hidden
              className="grid size-7 place-items-center rounded-lg [&>svg]:size-3.5"
              style={{
                color: TINT[o.kind],
                background: `color-mix(in srgb, ${TINT[o.kind]} 16%, transparent)`,
              }}
            >
              <Icon />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold">{o.label}</span>
              <span className="block text-[11.5px] text-muted-foreground">{reason ?? o.hint}</span>
            </span>
            <kbd
              aria-hidden
              className="rounded border border-border-secondary border-b-2 px-1 font-mono text-[10px] uppercase text-muted-foreground"
            >
              {o.key}
            </kbd>
          </button>
        );
      })}
      {side === 'out' && app.connections === 'error' && onRetry && (
        <div className="flex justify-end px-2 pb-1">
          <button
            type="button"
            onClick={onRetry}
            className="text-[12px] text-brand hover:underline"
          >
            Retry
          </button>
        </div>
      )}
      <div className="flex gap-2.5 px-2 pt-2 pb-1 text-[11px] text-muted-foreground">
        <span>↑↓ move</span>
        <span>↵ pick</span>
        <span>esc close</span>
      </div>
    </div>
  );
}
