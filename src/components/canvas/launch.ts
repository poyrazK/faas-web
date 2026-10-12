import { deploymentPhase } from '@/lib/deployment-status';

export type LaunchStage =
  | 'waiting'
  | 'queued'
  | 'building'
  | 'deploying'
  | 'live'
  | 'failed'
  /** The deployment could not be read: said so, never guessed. */
  | 'unavailable';
export type LaunchState = {
  slug: string;
  source: 'git' | 'cli';
  repo?: string;
  ref?: string;
  deploymentId?: string;
  stage: LaunchStage;
  step: 0 | 1 | 2 | 3 | 4;
  logLine?: string;
  failure?: string;
  /** A retry is in flight: the node must not offer a second one. */
  retrying?: boolean;
};

const DEPLOYING = new Set(['deploying', 'dispatching']);

/** Open API status → the four-step rail the node shows. */
export function launchStage(status: string | undefined): {
  stage: LaunchStage;
  step: 0 | 1 | 2 | 3 | 4;
} {
  if (!status) return { stage: 'waiting', step: 0 };
  const s = status.toLowerCase();
  const phase = deploymentPhase(s);
  if (phase === 'failed') return { stage: 'failed', step: 0 };
  // Superseded shipped and was replaced: it is not waiting on anything.
  if (phase === 'live' || phase === 'superseded') return { stage: 'live', step: 4 };
  if (DEPLOYING.has(s)) return { stage: 'deploying', step: 3 };
  if (phase === 'building') return { stage: 'building', step: 2 };
  return { stage: 'queued', step: 1 };
}
