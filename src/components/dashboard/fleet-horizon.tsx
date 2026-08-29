import { cn } from '@/lib/utils';

/**
 * The horizon — the overview's signature scene.
 *
 * One ground line across the page. Awake apps stand above it as lit,
 * breathing columns (one per resident instance); asleep apps hang below it
 * as dashed sockets sized to the memory they would claim on wake.
 * Scale-to-zero drawn literally: the fleet above the surface, its
 * potential sleeping under it.
 *
 * Every height is real arithmetic over `ram_mb` on one shared scale, so a
 * column above the line and a socket below it can be compared by eye.
 * There is no denominator beyond the fleet's own largest footprint.
 */

export interface HorizonApp {
  slug: string;
  /** MB per instance. */
  ramMb: number;
  /** Resident (non-parked) instances. 0 means the app is asleep. */
  instances: number;
  awake: boolean;
}

const footprintOf = (app: HorizonApp) => app.ramMb * Math.max(app.instances, 1);

/** Above-ground head-room in px; below-ground is sized to what hangs there. */
const ABOVE_PX = 116;
const COL_MIN_PX = 8;

export function FleetHorizon({ apps, className }: { apps: HorizonApp[]; className?: string }) {
  // Awake apps gather at the start, largest first, so the light collects on
  // one side of the line and the sleeping tail reads as one dark region.
  const ordered = [...apps].sort((a, b) => {
    if (a.awake !== b.awake) return a.awake ? -1 : 1;
    return footprintOf(b) - footprintOf(a);
  });
  if (ordered.length === 0) return null;

  const maxFp = Math.max(...ordered.map(footprintOf), 1);
  // One px-per-MB scale for both sides of the line.
  const px = (mb: number) => Math.max(COL_MIN_PX, Math.round((mb / maxFp) * (ABOVE_PX - COL_MIN_PX)) + COL_MIN_PX);

  const deepestStub = Math.max(0, ...ordered.filter((a) => !a.awake).map((a) => px(a.ramMb)));
  const belowPx = deepestStub > 0 ? deepestStub + 10 : 18;

  return (
    <div className={cn('flex flex-col', className)} role="img" aria-label={horizonLabel(ordered)}>
      {/* Above ground: a column per resident instance. */}
      <div className="flex items-end gap-1.5 sm:gap-2.5" style={{ height: ABOVE_PX }}>
        {ordered.map((app, appIndex) => (
          <div
            key={app.slug}
            title={hint(app)}
            className="flex h-full min-w-0 flex-1 items-end justify-center gap-[3px]"
          >
            {app.awake &&
              Array.from({ length: Math.max(app.instances, 1) }, (_, i) => (
                <span
                  key={i}
                  className="hz-col fp-lit animate-breathe w-full max-w-9 rounded-t-[3px]"
                  style={{
                    ['--hz-h' as string]: `${px(app.ramMb)}px`,
                    // Phase-shifted so the skyline shimmers rather than
                    // pulsing in lockstep; negative delay starts mid-cycle.
                    animationDelay: `${-((appIndex * 1.3 + i) % 3.4)}s`,
                  }}
                />
              ))}
          </div>
        ))}
      </div>

      {/* The ground line. */}
      <div aria-hidden className="h-px w-full bg-border-secondary" />

      {/* Below ground: a dashed socket per sleeping app. */}
      <div className="flex items-start gap-1.5 sm:gap-2.5" style={{ height: belowPx }}>
        {ordered.map((app) => (
          <div key={app.slug} className="flex h-full min-w-0 flex-1 items-start justify-center">
            {!app.awake && (
              <span
                className="hz-col fp-dark w-full max-w-9 rounded-b-[3px] border-t-0"
                style={{ ['--hz-h' as string]: `${px(app.ramMb)}px` }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Callouts: a tick and a mono dimension per app, under its slot. */}
      <div aria-hidden className="flex gap-1.5 sm:gap-2.5">
        {ordered.map((app) => (
          <div key={app.slug} className="min-w-0 flex-1">
            <div className="mx-auto h-2.5 w-px bg-border" />
            <p
              className={cn(
                'label-mono mt-1.5 truncate text-center normal-case',
                app.awake ? 'text-foreground' : 'text-muted-foreground/70'
              )}
            >
              {app.slug}
            </p>
            <p className="label-mono mt-0.5 hidden truncate text-center normal-case text-muted-foreground sm:block">
              {app.awake
                ? `${footprintOf(app).toLocaleString()} MB${app.instances > 1 ? ` × ${app.instances}` : ''}`
                : 'asleep'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function hint(app: HorizonApp): string {
  return `${app.slug} — ${
    app.awake
      ? `${footprintOf(app).toLocaleString()} MB resident`
      : `asleep, would wake at ${app.ramMb} MB`
  }`;
}

function horizonLabel(apps: HorizonApp[]): string {
  const awake = apps.filter((a) => a.awake);
  const asleep = apps.length - awake.length;
  const mb = awake.reduce((sum, a) => sum + footprintOf(a), 0);
  return `Fleet horizon: ${mb.toLocaleString()} MB resident across ${awake.length} awake ${
    awake.length === 1 ? 'app' : 'apps'
  }${asleep ? `, ${asleep} asleep below the line` : ''}.`;
}
