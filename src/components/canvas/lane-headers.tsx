import { COLUMN } from './layout';

/** Names the lanes once, quietly, in flow coordinates above the graph. */
export function LaneHeaders({ top }: { top: number }) {
  const lanes: [number, string][] = [
    [COLUMN.internet, 'Ingress'],
    [COLUMN.domain, 'Domains'],
    [COLUMN.app, 'Apps'],
    [COLUMN.resource, 'Resources'],
  ];
  return (
    <>
      {lanes.map(([x, name]) => (
        <span
          key={name}
          aria-hidden
          className="pointer-events-none absolute font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/55"
          style={{ transform: `translate(${x}px, ${top}px)` }}
        >
          {name}
        </span>
      ))}
    </>
  );
}
