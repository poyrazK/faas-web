import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Wind } from 'iconoir-react';
import { cn } from '@/lib/utils';

/**
 * The Relay — the fleet as a live flow map.
 *
 * The Gregale edge hub sits on the left; every app is a chip on the right,
 * wired to the hub by a curved route. Awake routes carry a travelling
 * pulse of light — the request path, alive; asleep routes are dashed and
 * dark until a request wakes them. All figures ride on the surface: name,
 * state, and the RAM each app holds (or would wake at).
 *
 * Routes are measured from the real DOM (ResizeObserver), so the map
 * reflows with the card. The pulse is pure CSS; reduced motion keeps the
 * cables and stills the light.
 */

export interface RelayApp {
  slug: string;
  /** MB per instance. */
  ramMb: number;
  /** Resident (non-parked) instances. 0 means the app is asleep. */
  instances: number;
  awake: boolean;
}

const footprintOf = (app: RelayApp) => app.ramMb * Math.max(app.instances, 1);

type Route = { d: string; awake: boolean };

export function BeamMap({ apps, className }: { apps: RelayApp[]; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef(new Map<string, HTMLElement>());
  const [routes, setRoutes] = useState<Route[]>([]);

  // Awake apps first, largest first — the lit routes bundle together.
  const ordered = [...apps].sort((a, b) => {
    if (a.awake !== b.awake) return a.awake ? -1 : 1;
    return footprintOf(b) - footprintOf(a);
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const hub = hubRef.current;
      if (!hub) return;
      const cr = container.getBoundingClientRect();
      const hr = hub.getBoundingClientRect();
      const sx = hr.right - cr.left + 2;
      const sy = hr.top + hr.height / 2 - cr.top;
      setRoutes(
        ordered.flatMap((app) => {
          const el = chipRefs.current.get(app.slug);
          if (!el) return [];
          const r = el.getBoundingClientRect();
          const ex = r.left - cr.left - 2;
          const ey = r.top + r.height / 2 - cr.top;
          const mx = sx + (ex - sx) * 0.55;
          return [{ d: `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}`, awake: app.awake }];
        })
      );
    };
    // ResizeObserver fires once on observe, which is also the initial measure.
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
    // Geometry depends on the set and order of chips, not object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered.map((a) => `${a.slug}:${a.awake}:${a.instances}`).join('|')]);

  if (ordered.length === 0) return null;

  return (
    <div ref={containerRef} className={cn('relative flex items-center gap-10 sm:gap-16', className)}>
      {/* The routes, drawn under the chips. */}
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        {routes.map((route, i) => (
          <g key={i}>
            <path
              d={route.d}
              fill="none"
              stroke="var(--border-secondary)"
              strokeWidth={1}
              strokeDasharray={route.awake ? undefined : '3 6'}
              opacity={route.awake ? 0.9 : 0.5}
            />
            {route.awake && (
              <path
                d={route.d}
                fill="none"
                stroke="var(--brand-fill)"
                strokeWidth={1.5}
                strokeLinecap="round"
                className="beam-pulse"
                style={{
                  animationDelay: `${-(i * 1.15)}s`,
                  filter:
                    'drop-shadow(0 0 5px color-mix(in oklab, var(--brand-fill) 60%, transparent))',
                }}
              />
            )}
          </g>
        ))}
      </svg>

      {/* The edge hub — where the gregale comes ashore. */}
      <div className="flex shrink-0 flex-col items-center gap-2.5 self-center">
        <div
          ref={hubRef}
          className="glass animate-breathe flex h-16 w-16 items-center justify-center rounded-full border border-border-secondary"
          style={{
            boxShadow: '0 0 26px color-mix(in oklab, var(--brand-fill) 28%, transparent)',
          }}
        >
          <Wind className="h-6 w-6 text-brand" aria-hidden />
        </div>
        <p className="label-mono text-muted-foreground">edge</p>
      </div>

      {/* The fleet. */}
      <ul aria-label={mapLabel(ordered)} className="relative z-10 flex min-w-0 flex-1 list-none flex-col gap-2.5">
        {ordered.map((app) => (
          <li
            key={app.slug}
            ref={(el) => {
              if (el) chipRefs.current.set(app.slug, el);
              else chipRefs.current.delete(app.slug);
            }}
            className="max-w-72"
          >
            <Link
              to="/dashboard/workflows/$workflowId"
              params={{ workflowId: app.slug }}
              className={cn(
                'glass pressable flex items-center gap-2.5 rounded-lg border px-3.5 py-2 transition-colors',
                app.awake
                  ? 'border-border-secondary hover:border-brand/50'
                  : 'border-border opacity-70 hover:opacity-100'
              )}
            >
              <span
                className={cn('h-1.5 w-1.5 shrink-0 rounded-full', app.awake && 'animate-breathe')}
                style={{
                  background: app.awake ? 'var(--brand-fill)' : 'var(--border-secondary)',
                  boxShadow: app.awake
                    ? '0 0 8px color-mix(in oklab, var(--brand-fill) 70%, transparent)'
                    : undefined,
                }}
              />
              <span className="truncate font-mono text-xs">{app.slug}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
                {app.awake ? (
                  <>
                    {footprintOf(app).toLocaleString()} MB
                    {app.instances > 1 && ` × ${app.instances}`}
                  </>
                ) : (
                  `asleep · ${app.ramMb.toLocaleString()} MB`
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function mapLabel(apps: RelayApp[]): string {
  const awake = apps.filter((a) => a.awake);
  const asleep = apps.length - awake.length;
  const mb = awake.reduce((sum, a) => sum + footprintOf(a), 0);
  return `Fleet: ${mb.toLocaleString()} MB resident across ${awake.length} awake ${
    awake.length === 1 ? 'app' : 'apps'
  }${asleep ? `, ${asleep} asleep` : ''}.`;
}
