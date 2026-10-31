import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import type { AccessConnection, AccessLane, Permission } from '@/lib/storage-access';
import './access-map.css';

/**
 * Everything that can reach one bucket, drawn as cables from the bucket to
 * what holds the key: the app's own code, API keys with a grant, and S3 keys.
 *
 * The cable says what flows. Mint runs out of the bucket (it can read), amber
 * runs into it (it can write), and both run side by side for read and write.
 * Everything a person reads or clicks is HTML; the SVG only draws the cables
 * between measured elements, so the map works for screen readers and stays a
 * plain list on narrow screens, where the cables are hidden.
 */

const VERB: Record<Permission, string> = {
  read: 'reads',
  write: 'writes',
  read_write: 'reads and writes',
};

const LANES: { lane: AccessLane; title: (app: string) => string; empty: string }[] = [
  { lane: 'app', title: (app) => `${app} code`, empty: 'Not connected' },
  { lane: 'api-key', title: () => 'API keys', empty: 'No API key has a grant' },
  { lane: 's3-key', title: () => 'S3 keys', empty: 'No S3 keys' },
];

interface Cable {
  id: string;
  d: string;
  /** The inbound (write) line runs the other way and stops short of the
   * bucket, so its arrowhead is not lost under the port strip. */
  dIn: string;
  /** Measured length in px, so the draw-in and flow are in real units. */
  length: number;
  permission: Permission;
  pending: boolean;
}

/** Length of a cubic Bézier, by sampling: close enough to animate a stroke. */
function bezierLength(p: number[]): number {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p;
  let length = 0;
  let px = x0;
  let py = y0;
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    const u = 1 - t;
    const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
    const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
    length += Math.hypot(x - px, y - py);
    px = x;
    py = y;
  }
  return Math.ceil(length);
}

export function AccessMap({
  bucket,
  app,
  connections,
  onSelect,
  onConnect,
}: {
  bucket: string;
  app: string;
  connections: AccessConnection[];
  onSelect: (connection: AccessConnection) => void;
  onConnect?: () => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const source = useRef<HTMLDivElement>(null);
  const ends = useRef(new Map<string, HTMLElement>());
  const [cables, setCables] = useState<Cable[]>([]);
  const [active, setActive] = useState<string | null>(null);

  const readers = connections.filter((c) => c.permission !== 'write').length;
  const writers = connections.filter((c) => c.permission !== 'read').length;

  const measure = useCallback(() => {
    const box = frame.current?.getBoundingClientRect();
    const from = source.current?.getBoundingClientRect();
    if (!box || !from || box.width === 0) return;
    const x0 = from.right - box.left + 2;
    const span = from.height * 0.6;
    const top = from.top - box.top + (from.height - span) / 2;
    setCables(
      connections.flatMap((c, i) => {
        const end = ends.current.get(c.id)?.getBoundingClientRect();
        if (!end) return [];
        // Fan the cables out of a strip of ports on the bucket's right edge.
        const y0 =
          top + (connections.length === 1 ? span / 2 : (span * i) / (connections.length - 1));
        const x1 = end.left - box.left - 6;
        const y1 = end.top - box.top + end.height / 2;
        const bend = Math.max(48, (x1 - x0) * 0.5);
        const points = [x0, y0, x0 + bend, y0, x1 - bend, y1, x1, y1];
        return [
          {
            id: c.id,
            d: `M ${x0} ${y0} C ${x0 + bend} ${y0}, ${x1 - bend} ${y1}, ${x1} ${y1}`,
            dIn: `M ${x1} ${y1} C ${x1 - bend} ${y1}, ${x0 + bend} ${y0}, ${x0 + 11} ${y0}`,
            length: bezierLength(points),
            permission: c.permission,
            pending: Boolean(c.pending),
          },
        ];
      })
    );
  }, [connections]);

  useLayoutEffect(() => {
    measure();
    const node = frame.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <figure
      aria-labelledby="access-map-title"
      className="access-map relative overflow-hidden rounded-2xl border border-border bg-card"
    >
      <figcaption id="access-map-title" className="sr-only">
        Who can reach {bucket}
      </figcaption>
      <div
        ref={frame}
        className="relative grid gap-6 p-5 sm:grid-cols-[minmax(0,14rem)_minmax(5rem,1fr)_minmax(0,24rem)] sm:gap-x-0 sm:p-8"
      >
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden h-full w-full sm:block"
        >
          <defs>
            <marker
              id="cable-out"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M0 0 L8 4 L0 8 z" style={{ fill: 'var(--brand)' }} />
            </marker>
            <marker
              id="cable-in"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M0 0 L8 4 L0 8 z" style={{ fill: 'var(--status-warning)' }} />
            </marker>
          </defs>
          {cables.map((cable, i) => (
            <CablePath
              key={cable.id}
              cable={cable}
              index={i}
              dimmed={active !== null && active !== cable.id}
              lit={active === cable.id}
            />
          ))}
        </svg>

        <div
          ref={source}
          className="access-map__node relative flex flex-col justify-center gap-3 self-center rounded-xl border border-border bg-background/80 px-5 py-5"
        >
          <p className="access-map__name text-3xl font-semibold leading-none tracking-tight [overflow-wrap:anywhere] sm:text-4xl">
            {bucket}
          </p>
          <p className="font-mono text-xs text-muted-foreground">s3://{bucket}</p>
          <p className="text-sm text-muted-foreground">
            {connections.length === 0 ? (
              'Nothing can reach this bucket yet.'
            ) : (
              <>
                <span className={readers ? 'text-[color:var(--brand)]' : undefined}>
                  {readers} can read
                </span>
                <span aria-hidden="true">, </span>
                <span className="sr-only">, </span>
                <span className={writers ? 'text-[color:var(--status-warning)]' : undefined}>
                  {writers} can write
                </span>
              </>
            )}
          </p>
          <span
            aria-hidden="true"
            className="access-map__ports absolute -right-[3px] top-1/2 hidden h-3/5 w-[5px] -translate-y-1/2 rounded-full sm:block"
          />
        </div>

        <span aria-hidden="true" className="hidden sm:block" />

        <div className="flex flex-col gap-5">
          {LANES.map(({ lane, title, empty }) => {
            const items = connections.filter((c) => c.lane === lane);
            const name = title(app);
            return (
              <div key={lane} role="group" aria-label={name} className="flex flex-col gap-1.5">
                <p className="text-xs text-muted-foreground">{name}</p>
                {items.length === 0 ? (
                  lane === 'app' && onConnect && connections.length === 0 ? (
                    <button
                      type="button"
                      onClick={onConnect}
                      className="access-map__ghost pressable self-start rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:border-[color:var(--brand)] hover:text-foreground"
                    >
                      Connect {app}
                    </button>
                  ) : (
                    <p className="text-sm text-muted-foreground/70">{empty}</p>
                  )
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {items.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          ref={(node) => {
                            if (node) ends.current.set(c.id, node);
                            else ends.current.delete(c.id);
                          }}
                          onClick={() => onSelect(c)}
                          onPointerEnter={() => setActive(c.id)}
                          onPointerLeave={() => setActive(null)}
                          onFocus={() => setActive(c.id)}
                          onBlur={() => setActive(null)}
                          className={cn(
                            'access-map__end pressable group flex w-full min-w-0 items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2 text-left transition-[opacity,border-color]',
                            active !== null && active !== c.id && 'opacity-45'
                          )}
                          data-permission={c.permission}
                          data-pending={c.pending ? '' : undefined}
                        >
                          <span
                            aria-hidden="true"
                            className="access-map__port h-2.5 w-2.5 shrink-0 rounded-full"
                          />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs">
                            {c.label}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {c.pending ? 'rotating key' : VERB[c.permission]}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </figure>
  );
}

function CablePath({
  cable,
  index,
  dimmed,
  lit,
}: {
  cable: Cable;
  index: number;
  dimmed: boolean;
  lit: boolean;
}) {
  const style = {
    animationDelay: `${index * 90}ms`,
    '--cable-length': `${cable.length}px`,
  } as CSSProperties;
  const className = cn('access-cable', dimmed && 'access-cable--dim', lit && 'access-cable--lit');
  if (cable.pending)
    return <path d={cable.d} className={cn(className, 'access-cable--pending')} style={style} />;
  const read = cable.permission !== 'write';
  const write = cable.permission !== 'read';
  const offset = read && write ? 2.5 : 0;
  return (
    <g className={className} style={style}>
      {read && (
        <path
          d={cable.d}
          transform={offset ? `translate(0 ${-offset})` : undefined}
          className="access-cable__line access-cable__line--read"
          markerEnd="url(#cable-out)"
        />
      )}
      {write && (
        <path
          d={cable.dIn}
          transform={offset ? `translate(0 ${offset})` : undefined}
          className="access-cable__line access-cable__line--write"
          markerEnd="url(#cable-in)"
        />
      )}
    </g>
  );
}
