import { describe, expect, it, vi } from 'vitest';
import { toFlow } from './flow';
import type { Topology } from './topology';

const t: Topology = {
  nodes: [
    { id: 'internet', data: { kind: 'internet' } },
    {
      id: 'app:a',
      data: { kind: 'app', slug: 'a', phase: 'running', metrics: 'ready', connections: 'ready' },
    },
    {
      id: 'cron:c',
      data: {
        kind: 'cron',
        id: 'c',
        schedule: '* * * * *',
        path: '/',
        timezone: 'UTC',
        enabled: true,
        lastFiredAt: null,
        appSlug: 'a',
      },
    },
  ],
  edges: [
    { id: 'i', source: 'internet', target: 'app:a', kind: 'ingress', requests24h: 10 },
    { id: 's', source: 'cron:c', target: 'app:a', kind: 'schedule' },
  ],
  issues: [],
};
const pos = new Map([
  ['internet', { x: 0, y: 0 }],
  ['app:a', { x: 400, y: 0 }],
  ['cron:c', { x: 400, y: -80 }],
]);

describe('toFlow', () => {
  it('types each node by kind and places it', () => {
    const { nodes } = toFlow(t, pos);
    expect(nodes.map((n) => [n.id, n.type, n.position])).toEqual([
      ['internet', 'internet', { x: 0, y: 0 }],
      ['app:a', 'app', { x: 400, y: 0 }],
      ['cron:c', 'cron', { x: 400, y: -80 }],
    ]);
  });

  it('wires schedules into the top of the app and everything else left to right', () => {
    const { edges } = toFlow(t, pos);
    expect(edges.find((e) => e.id === 's')).toMatchObject({
      type: 'wind',
      sourceHandle: 'out',
      targetHandle: 'top',
    });
    expect(edges.find((e) => e.id === 'i')).toMatchObject({
      sourceHandle: 'out',
      targetHandle: 'in',
      data: { requests24h: 10 },
    });
  });

  it('hands apps a connect callback bound to their slug', () => {
    const onConnect = vi.fn();
    const app = toFlow(t, pos, { onConnect }).nodes.find((n) => n.id === 'app:a')!;
    (app.data as { onConnect: (s: 'in') => void }).onConnect('in');
    expect(onConnect).toHaveBeenCalledWith('a', 'in');
  });
  it('hands apps a retry bound to their slug', () => {
    const onRetry = vi.fn();
    const app = toFlow(t, pos, { onRetry }).nodes.find((n) => n.id === 'app:a')!;
    (app.data as { onRetry: () => void }).onRetry();
    expect(onRetry).toHaveBeenCalledWith('a');
  });
});
