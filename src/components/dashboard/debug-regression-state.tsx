import type { ComponentType, SVGProps } from 'react';
import { CheckCircle, Eye, EyeClosed, WarningTriangle } from 'iconoir-react';
import type { DebugRegressionReview } from '@/lib/api/debug';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** A regression's stored triage state, as colour, icon and word. */
const STATES: Record<DebugRegressionReview['state'], { label: string; color: string; icon: Icon }> =
  {
    active: { label: 'Open', color: 'var(--status-critical)', icon: WarningTriangle },
    acknowledged: { label: 'Acknowledged', color: 'var(--status-warning)', icon: Eye },
    dismissed: { label: 'Dismissed', color: 'var(--muted-foreground)', icon: EyeClosed },
    resolved: { label: 'Resolved', color: 'var(--status-good)', icon: CheckCircle },
  };

export function RegressionState({ state }: { state: DebugRegressionReview['state'] }) {
  const { label, color, icon: Glyph } = STATES[state] ?? STATES.active;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color }}>
      <Glyph aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {label}
    </span>
  );
}
