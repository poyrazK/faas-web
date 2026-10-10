import { describe, expect, it } from 'vitest';
import { neighbourhood } from './focus';
import type { Topology } from './topology';

const t: Topology = {
  nodes: [
    { id: 'internet', data: { kind: 'internet' } },
    {
      id: 'domain:d',
      data: { kind: 'domain', domain: 'd', verified: true, txtRecord: null, appSlug: 'a' },
    },
    {
      id: 'app:a',
      data: { kind: 'app', slug: 'a', phase: 'running', metrics: 'ready', connections: 'ready' },
    },
    {
      id: 'app:b',
      data: { kind: 'app', slug: 'b', phase: 'running', metrics: 'ready', connections: 'ready' },
    },
  ],
  edges: [
    { id: 'e1', source: 'internet', target: 'domain:d', kind: 'ingress' },
    { id: 'e2', source: 'domain:d', target: 'app:a', kind: 'ingress' },
    { id: 'e3', source: 'internet', target: 'app:b', kind: 'ingress' },
  ],
  issues: [],
};

describe('neighbourhood', () => {
  it('is the node, its one-hop neighbours, and the edges between them', () => {
    expect(neighbourhood(t, 'domain:d')).toEqual({
      nodes: new Set(['domain:d', 'internet', 'app:a']),
      edges: new Set(['e1', 'e2']),
    });
  });

  it('is just the node when it has no edges', () => {
    expect(neighbourhood({ ...t, edges: [] }, 'app:a')).toEqual({
      nodes: new Set(['app:a']),
      edges: new Set(),
    });
  });
});
