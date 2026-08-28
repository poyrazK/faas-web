import { cn } from '@/lib/utils';

/**
 * The Footprint band — the console's signature element.
 *
 * One horizontal band showing the fleet's memory as it stands: a lit,
 * breathing segment per resident instance, and an unlit outline per parked
 * app sized to the memory it *would* hold awake. The dark portion is
 * scale-to-zero made visible — memory the customer is not paying for.
 *
 * Annotated like an engineering drawing: leader lines dropping to mono
 * callouts, a tick ruler along the base, dimensions instead of legends.
 * Every width is real arithmetic over `ram_mb`; there is no denominator
 * beyond the fleet's own potential, so the band stays honest whether one
 * node or twenty serve it.
 */

export interface FootprintApp {
  slug: string;
  /** MB per instance. */
  ramMb: number;
  /** Resident (non-parked) instances. 0 means the app is asleep. */
  instances: number;
  awake: boolean;
}

/** Callouts under this share of the band are leader-line only — the label
 * would not fit and a clipped slug is worse than a hover title. */
const CALLOUT_MIN_PCT = 9;

export function FootprintBand({ apps, className }: { apps: FootprintApp[]; className?: string }) {
  // Awake apps first, largest footprint first — the light gathers at the
  // band's start and the dark tail reads as one region of sleep.
  const ordered = [...apps].sort((a, b) => {
    if (a.awake !== b.awake) return a.awake ? -1 : 1;
    return b.ramMb * Math.max(b.instances, 1) - a.ramMb * Math.max(a.instances, 1);
  });

  const footprintOf = (app: FootprintApp) => app.ramMb * Math.max(app.instances, 1);
  const totalMb = ordered.reduce((sum, app) => sum + footprintOf(app), 0);
  const awakeMb = ordered.filter((a) => a.awake).reduce((sum, a) => sum + footprintOf(a), 0);

  if (totalMb === 0) return null;

  return (
    <div className={cn('flex flex-col', className)}>
      {/* The band. Segments per app; an awake app subdivides into its
          instances with hairline gaps, so granularity is visible without a
          second row. */}
      <div className="flex h-9 items-stretch gap-[3px]" role="img" aria-label={bandLabel(ordered)}>
        {ordered.map((app, appIndex) => {
          const pct = (footprintOf(app) / totalMb) * 100;
          return (
            <div
              key={app.slug}
              style={{ width: `${pct}%` }}
              className="flex min-w-[3px] items-stretch gap-px"
              title={`${app.slug} — ${app.awake ? `${footprintOf(app).toLocaleString()} MB resident` : `asleep, would wake at ${app.ramMb} MB`}`}
            >
              {app.awake ? (
                Array.from({ length: app.instances }, (_, i) => (
                  <span
                    key={i}
                    className="animate-breathe min-w-[2px] flex-1 rounded-[2px] bg-brand-fill"
                    // Phase-shifted so the band shimmers rather than pulsing
                    // in lockstep; negative delay starts mid-cycle.
                    style={{ animationDelay: `${-((appIndex * 1.3 + i) % 3.4)}s` }}
                  />
                ))
              ) : (
                <span className="flex-1 rounded-[2px] border border-border bg-transparent" />
              )}
            </div>
          );
        })}
      </div>

      {/* Tick ruler — the drawing's measure line. Pure decoration over real
          proportions, so it is hidden from AT. */}
      <div
        aria-hidden
        className="mt-1.5 h-1.5 border-b border-border"
        style={{
          backgroundImage:
            'repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px 48px)',
        }}
      />

      {/* Blueprint callouts: a leader line at each app's left edge, a mono
          dimension label where there is room. Widths mirror the band, so the
          leaders land exactly under their segments. */}
      <div aria-hidden className="flex gap-[3px]">
        {ordered.map((app) => {
          const pct = (footprintOf(app) / totalMb) * 100;
          const labeled = pct >= CALLOUT_MIN_PCT;
          return (
            <div key={app.slug} style={{ width: `${pct}%` }} className="min-w-0">
              <div className="ml-[3px] h-2.5 w-px bg-border" />
              {labeled && (
                <p
                  className={cn(
                    'label-mono mt-1 truncate pl-[3px] normal-case',
                    app.awake ? 'text-foreground' : 'text-muted-foreground/70'
                  )}
                >
                  {app.slug}
                  <span className="text-muted-foreground">
                    {' '}
                    — {app.awake ? `${footprintOf(app).toLocaleString()} MB` : 'asleep'}
                    {app.awake && app.instances > 1 ? ` × ${app.instances}` : ''}
                  </span>
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* The dimension line's totals — the sentence the drawing measures. */}
      <p className="mt-3 text-xs text-muted-foreground">
        <span className="text-foreground [font-variant-numeric:tabular-nums]">
          {awakeMb.toLocaleString()} MB
        </span>{' '}
        awake
        {totalMb > awakeMb && (
          <>
            {' · '}
            <span className="[font-variant-numeric:tabular-nums]">
              {(totalMb - awakeMb).toLocaleString()} MB
            </span>{' '}
            dark — memory parked apps hold only when a request arrives
          </>
        )}
      </p>
    </div>
  );
}

function bandLabel(apps: FootprintApp[]): string {
  const awake = apps.filter((a) => a.awake);
  const asleep = apps.length - awake.length;
  const mb = awake.reduce((sum, a) => sum + a.ramMb * Math.max(a.instances, 1), 0);
  return `Memory footprint: ${mb.toLocaleString()} MB resident across ${awake.length} awake ${
    awake.length === 1 ? 'app' : 'apps'
  }${asleep ? `, ${asleep} asleep` : ''}.`;
}
