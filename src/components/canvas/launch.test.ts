import { describe, expect, it } from 'vitest';
import { launchStage } from './launch';

describe('launchStage', () => {
  it.each([
    [undefined, 'waiting', 0],
    ['queued', 'queued', 1],
    ['pending', 'queued', 1],
    ['building', 'building', 2],
    ['imaging', 'building', 2],
    ['deploying', 'deploying', 3],
    ['dispatching', 'deploying', 3],
    ['active', 'live', 4],
    ['superseded', 'live', 4],
    ['failed', 'failed', 0],
  ] as const)('%s → %s (step %i)', (status, stage, step) => {
    expect(launchStage(status)).toEqual({ stage, step });
  });
});
