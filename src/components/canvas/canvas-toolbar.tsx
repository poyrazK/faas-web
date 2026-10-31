import { useEffect, useState } from 'react';
import { Panel, useReactFlow, useStore } from '@xyflow/react';
import { Minus, Plus, Search, Expand } from 'iconoir-react';
import { cn } from '@/lib/utils';
import { JumpFinder, type JumpItem } from './jump-finder';

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

const btn =
  'pressable flex h-[30px] items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

export function CanvasToolbar({
  items,
  onPick,
  onNew,
  shortcuts = true,
}: {
  items: JumpItem[];
  onPick: (id: string) => void;
  onNew?: () => void;
  /** Off while the wizard, a menu or a draft owns the keyboard. */
  shortcuts?: boolean;
}) {
  const flow = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const [finding, setFinding] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!shortcuts || typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        setFinding(true);
      } else if (e.key.toLowerCase() === 'n' && onNew) {
        e.preventDefault();
        onNew();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNew, shortcuts]);

  return (
    <Panel position="bottom-center" className="!mb-4">
      <div className="relative flex items-center gap-1 rounded-xl border border-canvas-glass-border bg-canvas-glass p-1 shadow-elevation-3 backdrop-blur-md">
        {finding && (
          <JumpFinder
            items={items}
            onClose={() => setFinding(false)}
            onPick={(id) => {
              setFinding(false);
              onPick(id);
            }}
          />
        )}
        {onNew && (
          <button
            type="button"
            onClick={onNew}
            className={cn(
              btn,
              'bg-brand font-semibold text-primary-foreground hover:bg-brand-hover hover:text-primary-foreground'
            )}
          >
            <Plus aria-hidden className="size-3.5" strokeWidth={2.2} /> New
          </button>
        )}
        <span aria-hidden className="mx-0.5 h-[18px] w-px bg-border" />
        <button
          type="button"
          onClick={() => setFinding((v) => !v)}
          className={cn(btn, 'w-52 justify-between')}
        >
          <span className="flex items-center gap-1.5">
            <Search aria-hidden className="size-3.5" /> Jump to a node
          </span>
          <kbd className="rounded border border-border-secondary border-b-2 px-1 font-mono text-[10px]">
            /
          </kbd>
        </button>
        <span aria-hidden className="mx-0.5 h-[18px] w-px bg-border" />
        <button
          type="button"
          aria-label="Fit to view"
          onClick={() => void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 380 })}
          className={btn}
        >
          <Expand aria-hidden className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => void flow.zoomOut({ duration: 150 })}
          className={btn}
        >
          <Minus aria-hidden className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Zoom ${Math.round(zoom * 100)}%, reset to 100%`}
          onClick={() => void flow.zoomTo(1, { duration: 240 })}
          className={cn(btn, 'w-12 justify-center font-mono text-[11px] tabular-nums')}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => void flow.zoomIn({ duration: 150 })}
          className={btn}
        >
          <Plus aria-hidden className="size-3.5" />
        </button>
      </div>
    </Panel>
  );
}
