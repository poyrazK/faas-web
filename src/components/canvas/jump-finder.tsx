import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fuzzyMatch } from '@/lib/fuzzy';
import { cn } from '@/lib/utils';
import type { CanvasNodeKind } from './topology';

export type JumpItem = { id: string; title: string; kind: CanvasNodeKind };

const KIND: Record<CanvasNodeKind, string> = {
  internet: 'Ingress',
  domain: 'Domain',
  app: 'App',
  cron: 'Cron',
  bucket: 'Bucket',
  postgres: 'Postgres',
};

export function JumpFinder({
  items,
  onPick,
  onClose,
}: {
  items: JumpItem[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus({ preventScroll: true }), []);

  const results = useMemo(
    () =>
      items
        .map((item) => ({ item, m: fuzzyMatch(item.title, query) }))
        .filter((r): r is { item: JumpItem; m: NonNullable<typeof r.m> } => r.m !== null)
        .sort((a, b) => b.m.score - a.m.score)
        .slice(0, 8)
        .map((r) => r.item),
    [items, query]
  );

  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return onClose();
    if (e.key === 'ArrowDown')
      return void (e.preventDefault(), setActive((i) => Math.min(i + 1, results.length - 1)));
    if (e.key === 'ArrowUp') return void (e.preventDefault(), setActive((i) => Math.max(i - 1, 0)));
    if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      onPick(results[active].id);
    }
  };

  return (
    <div className="absolute bottom-[calc(100%+8px)] left-1/2 w-80 -translate-x-1/2 animate-item-enter rounded-xl border border-border bg-popover p-1.5 shadow-elevation-3">
      <input
        ref={input}
        role="combobox"
        aria-label="Jump to a node"
        aria-expanded
        aria-controls="canvas-jump-results"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={key}
        placeholder="Jump to a node…"
        className="h-9 w-full rounded-lg bg-transparent px-2.5 text-[13px] outline-none placeholder:text-muted-foreground"
      />
      <ul id="canvas-jump-results" role="listbox" className="mt-1 max-h-72 overflow-y-auto">
        {results.length === 0 && (
          <li className="px-2.5 py-2 text-[12.5px] text-muted-foreground">No node matches</li>
        )}
        {results.map((r, i) => (
          <li
            key={r.id}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(r.id);
            }}
            className={cn(
              'flex h-9 cursor-pointer items-center justify-between rounded-lg px-2.5 text-[12.5px]',
              i === active && 'bg-accent'
            )}
          >
            <span className="truncate">{r.title}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {KIND[r.kind]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
