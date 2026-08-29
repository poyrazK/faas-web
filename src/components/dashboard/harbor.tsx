import { Link } from '@tanstack/react-router';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * The Harbor — the overview's centerpiece, and the console's signature.
 *
 * Gregale is a Mediterranean wind, so the fleet is drawn as a harbor at
 * night: every resident instance is a lit filament standing on the
 * waterline, mirrored faintly in the water beneath; an asleep app is an
 * unlit berth on the line, holding nothing. Scale-to-zero is the dark
 * water between the lights.
 *
 * Sleek by omission: no labels, no legends, no boxes. Hovering a berth
 * names it; clicking sails to the app. Every filament height is real
 * arithmetic over `ram_mb` on one shared scale — the only denominator is
 * the fleet's own largest instance.
 */

export interface HarborApp {
  slug: string;
  /** MB per instance. */
  ramMb: number;
  /** Resident (non-parked) instances. 0 means the app is asleep. */
  instances: number;
  awake: boolean;
}

const footprintOf = (app: HarborApp) => app.ramMb * Math.max(app.instances, 1);

/** Sky head-room and water depth, px. */
const SKY_PX = 132;
const WATER_PX = 64;
const FILAMENT_MIN_PX = 14;

export function Harbor({ apps, className }: { apps: HarborApp[]; className?: string }) {
  // Lit berths gather at the harbor's center, largest first, so the light
  // collects in one place and the dark berths keep to the edges.
  const bySize = [...apps].sort((a, b) => footprintOf(b) - footprintOf(a));
  const ordered: HarborApp[] = [];
  for (const [i, app] of bySize.entries()) {
    if (i % 2 === 0) ordered.push(app);
    else ordered.unshift(app);
  }
  if (ordered.length === 0) return null;

  const maxMb = Math.max(...ordered.map((a) => a.ramMb), 1);
  const filamentPx = (mb: number) =>
    Math.max(FILAMENT_MIN_PX, Math.round((mb / maxMb) * (SKY_PX - 20)));

  return (
    <div className={cn('flex flex-col', className)}>
      <ul
        aria-label={harborLabel(ordered)}
        className="flex list-none items-end justify-center gap-4 sm:gap-6"
        style={{ height: SKY_PX }}
      >
        {ordered.map((app, appIndex) => (
          <li key={app.slug} className="flex h-full min-w-0 items-end">
            <Tooltip content={<span className="font-mono">{hint(app)}</span>} side="top">
              <Link
                to="/dashboard/workflows/$workflowId"
                params={{ workflowId: app.slug }}
                aria-label={hint(app)}
                className="group flex h-full items-end gap-[5px] rounded px-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {app.awake ? (
                  Array.from({ length: Math.max(app.instances, 1) }, (_, i) => (
                    <span
                      key={i}
                      className="hz-col fp-lit animate-breathe w-[5px] rounded-full transition-[filter] duration-300 group-hover:brightness-125"
                      style={{
                        ['--hz-h' as string]: `${filamentPx(app.ramMb)}px`,
                        // Phase-shifted so the harbor shimmers rather than
                        // pulsing in lockstep; negative delay starts mid-cycle.
                        animationDelay: `${-((appIndex * 1.3 + i) % 3.4)}s`,
                      }}
                    />
                  ))
                ) : (
                  // An unlit berth: a mark on the line, nothing standing on it.
                  <span className="mb-[3px] block h-[3px] w-7 rounded-full bg-border-secondary transition-colors duration-300 group-hover:bg-muted-foreground" />
                )}
              </Link>
            </Tooltip>
          </li>
        ))}
      </ul>

      {/* The waterline. */}
      <div
        aria-hidden
        className="h-px w-full bg-border-secondary"
        style={{ boxShadow: '0 0 18px color-mix(in oklab, var(--brand-fill) 22%, transparent)' }}
      />

      {/* The water: each lit filament reflected, fading with depth. The row
          mirrors the sky's geometry exactly so every reflection lands under
          its light. */}
      <div
        aria-hidden
        className="flex items-start justify-center gap-4 sm:gap-6"
        style={{ height: WATER_PX }}
      >
        {ordered.map((app) => (
          <div key={app.slug} className="flex min-w-0 items-start gap-[5px] px-0.5">
            {app.awake ? (
              Array.from({ length: Math.max(app.instances, 1) }, (_, i) => (
                <span
                  key={i}
                  className="hz-col hz-refl w-[5px] rounded-full"
                  style={{
                    ['--hz-h' as string]: `${Math.round(filamentPx(app.ramMb) * 0.55)}px`,
                  }}
                />
              ))
            ) : (
              <span className="w-7" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function hint(app: HarborApp): string {
  return app.awake
    ? `${app.slug} — ${footprintOf(app).toLocaleString()} MB${
        app.instances > 1 ? ` × ${app.instances}` : ''
      } resident`
    : `${app.slug} — asleep, wakes at ${app.ramMb.toLocaleString()} MB`;
}

function harborLabel(apps: HarborApp[]): string {
  const awake = apps.filter((a) => a.awake);
  const asleep = apps.length - awake.length;
  const mb = awake.reduce((sum, a) => sum + footprintOf(a), 0);
  return `Fleet: ${mb.toLocaleString()} MB resident across ${awake.length} awake ${
    awake.length === 1 ? 'app' : 'apps'
  }${asleep ? `, ${asleep} asleep` : ''}.`;
}
