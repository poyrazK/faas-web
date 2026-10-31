import type { ComponentType, SVGProps } from 'react';
import { useReducedMotion } from 'motion/react';
import {
  CheckCircle,
  Circle,
  HelpCircle,
  Minus,
  RefreshDouble,
  WarningTriangle,
} from 'iconoir-react';
import { releaseProcessSummary, type PhaseState, type ReleasePhase } from '@/lib/release-process';
import { cn } from '@/lib/utils';

const STATE: Record<
  PhaseState,
  { label: string; color: string; icon: ComponentType<SVGProps<SVGSVGElement>> }
> = {
  done: { label: 'Done', color: 'var(--status-good)', icon: CheckCircle },
  active: { label: 'In progress', color: 'var(--brand)', icon: RefreshDouble },
  failed: { label: 'Failed', color: 'var(--status-critical)', icon: WarningTriangle },
  pending: { label: 'Waiting', color: 'var(--muted-foreground)', icon: Circle },
  skipped: { label: 'Skipped', color: 'var(--muted-foreground)', icon: Minus },
  unrecorded: { label: 'Not recorded', color: 'var(--muted-foreground)', icon: HelpCircle },
};

function PhaseIcon({ state, className }: { state: PhaseState; className?: string }) {
  const reduce = useReducedMotion();
  const { icon: Icon, color } = STATE[state];
  return (
    <Icon
      aria-hidden
      className={cn(className, state === 'active' && !reduce && 'animate-spin')}
      style={{ color }}
    />
  );
}

/**
 * A release as a process — build, verify, prepare, roll out, serve — with
 * each phase's state as colour, icon and words. `compact` is the one-line form
 * for list rows; the full form is a timeline with each phase's detail.
 */
export function ReleaseProcess({
  phases,
  compact = false,
}: {
  phases: ReleasePhase[];
  compact?: boolean;
}) {
  if (compact)
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <ol aria-label="Release process" className="flex items-center gap-1">
          {phases.map((phase, index) => (
            <li key={phase.key} className="flex items-center gap-1">
              <PhaseIcon state={phase.state} className="h-3.5 w-3.5" />
              <span className="sr-only">
                {phase.label}: {STATE[phase.state].label}
              </span>
              {index < phases.length - 1 && <span aria-hidden className="h-px w-2 bg-border" />}
            </li>
          ))}
        </ol>
        <span className="truncate text-xs text-muted-foreground">
          {releaseProcessSummary(phases)}
        </span>
      </div>
    );
  return (
    <ol aria-label="Release process" className="flex flex-col">
      {phases.map((phase, index) => (
        <li key={phase.key} className="flex gap-3">
          <div className="flex flex-col items-center">
            <PhaseIcon state={phase.state} className="mt-0.5 h-4 w-4 shrink-0" />
            {index < phases.length - 1 && <span aria-hidden className="w-px flex-1 bg-border" />}
          </div>
          <div className="min-w-0 pb-4">
            <p className="text-sm">
              <span className="font-medium">{phase.label}</span>
              <span className="ml-2 text-xs" style={{ color: STATE[phase.state].color }}>
                {STATE[phase.state].label}
              </span>
            </p>
            {phase.detail && (
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {phase.detail}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
