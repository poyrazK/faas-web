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
  if (!app.buckets) return 'Checking storage…';
  if (!app.buckets.enabled) return 'Object storage is not enabled for this account.';
  if (app.buckets.atLimit) return 'This app is at its bucket limit.';
}

export function ConnectMenu({
  app,
  side,
  at,
  onPick,
  onClose,
}: {
  app: AppData;
  side: ConnectSide;
  at: Point;
  onPick: (kind: CreateKind) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const options = CREATE_OPTIONS[side];

  useEffect(() => {
    ref.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      const hit = options.find(
        (o) => o.key === e.key.toLowerCase() && !disabledReason(o.kind, app)
      );
      if (hit) onPick(hit.kind);
    };
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [app, onClose, onPick, options]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={side === 'in' ? `Send traffic into ${app.slug}` : `Connect ${app.slug} to`}
      className="nodrag nopan absolute z-10 w-64 animate-item-enter rounded-[10px] border border-border bg-popover p-1.5 shadow-elevation-3"
      style={{ transform: `translate(${at.x}px, ${at.y}px)` }}
    >
      <p className="label-mono px-2 pb-1 pt-1.5 text-[10.5px] text-muted-foreground">
        {side === 'in' ? `Send traffic into ${app.slug}` : `Connect ${app.slug} to`}
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
              'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left',
              'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50'
            )}
          >
            <span
              aria-hidden
              className="grid size-[26px] place-items-center rounded-md [&>svg]:size-3.5"
              style={{
                color: TINT[o.kind],
                background: `color-mix(in srgb, ${TINT[o.kind]} 16%, transparent)`,
              }}
            >
              <Icon />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold">{o.label}</span>
              <span className="block text-xs text-muted-foreground">{reason ?? o.hint}</span>
            </span>
            <kbd
              aria-hidden
              className="rounded border border-border-secondary px-1 font-mono text-[10px] uppercase text-muted-foreground"
            >
              {o.key}
            </kbd>
          </button>
        );
      })}
    </div>
  );
}
