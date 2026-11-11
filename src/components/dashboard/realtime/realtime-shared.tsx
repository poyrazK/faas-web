import type { ComponentType, ReactNode, SVGProps } from 'react';
import { CheckCircle, Circle, PauseSolid, WarningTriangle } from 'iconoir-react';
import { ApiError, errorMessage } from '@/lib/api/errors';

/** apid's channel rule (openapi `pattern: '^[^/?#\r\n ]+$'`, 1 to 256 characters). */
const CHANNEL = /^[^/?#\r\n ]+$/;

export function channelError(value: string): string | undefined {
  if (!value) return 'Name a channel.';
  if (value.length > 256) return 'Use 256 characters or fewer.';
  if (!CHANNEL.test(value)) return 'A channel name has no spaces, slashes, “?” or “#”.';
  return undefined;
}

/** Channels typed as a list: commas, spaces or new lines, duplicates dropped. */
export function parseChannels(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter(Boolean))];
}

type Tone = 'good' | 'warning' | 'critical' | 'muted';
const TONE: Record<Tone, string> = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
  muted: 'var(--chart-muted)',
};
const ICON: Record<Tone, ComponentType<SVGProps<SVGSVGElement>>> = {
  good: CheckCircle,
  warning: PauseSolid,
  critical: WarningTriangle,
  muted: Circle,
};

/** Status as colour, icon and label together — never hue alone. */
export function StatusTag({ tone, label }: { tone: Tone; label: string }) {
  const Icon = ICON[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs"
      style={{
        backgroundColor: `color-mix(in oklab, ${TONE[tone]} 14%, transparent)`,
        color: TONE[tone],
      }}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}

/**
 * A fleet read that some realtime nodes did not answer. apid still returns
 * what the reachable nodes said, so counts and lists may be low.
 */
export function PartialNotice({
  queried,
  unavailable,
  what,
}: {
  queried: number;
  unavailable: number;
  what: string;
}) {
  const total = queried + unavailable;
  return (
    <p role="status" className="flex items-start gap-2 text-xs text-muted-foreground">
      <WarningTriangle
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
        style={{ color: 'var(--status-warning)' }}
        aria-hidden
      />
      <span>
        {unavailable} of {total} realtime {total === 1 ? 'node' : 'nodes'} did not answer, so {what}{' '}
        may be incomplete.
      </span>
    </p>
  );
}

/**
 * A realtime error in words, branched on apid's codes (faas pkg/api/errors.go
 * and pkg/apid/managedrealtime). Anything else is the problem's own sentence.
 */
export function explainRealtime(err: unknown): string {
  if (!(err instanceof ApiError)) return errorMessage(err);
  switch (err.code) {
    case 'plan_realtime_not_allowed':
      return 'Managed realtime is not included in your plan. Hobby and above include it.';
    case 'realtime_write_rate_limited':
      return 'Your endpoints are writing retained messages faster than your plan allows. Nothing was written; try again in a moment.';
    case 'realtime_connection_limit':
      return 'Your account has reached its concurrent connection limit.';
    default:
      return errorMessage(err);
  }
}

/** A toast's error part: apid's problem (so its help renders) with our wording. */
export function explainToast(err: unknown) {
  return { error: err, description: explainRealtime(err) };
}

export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{title}</h3>
          {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
