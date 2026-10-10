import type { CanvasNodeKind, Topology } from './topology';
import { nodeId } from './topology';

/**
 * Deterministic columns, no layout engine: Internet, then domains, then apps,
 * then what the apps talk to. Each app owns a horizontal band, so a glance
 * down the app column is a glance down the account. Positions are top-left,
 * as React Flow expects.
 */
export const NODE_SIZE: Record<CanvasNodeKind, { w: number; h: number }> = {
  internet: { w: 44, h: 44 },
  domain: { w: 216, h: 56 },
  app: { w: 248, h: 76 },
  cron: { w: 216, h: 56 },
  bucket: { w: 216, h: 56 },
  postgres: { w: 216, h: 56 },
};

export type Point = { x: number; y: number };

export const COLUMN = { internet: 0, domain: 120, app: 456, resource: 824 };
const ROW = 96; // tallest node (76) + 20
const STACK = 72; // 56 + 16, for crons above an app
const BAND_GAP = 56;

export function layout(t: Topology): Map<string, Point> {
  const pos = new Map<string, Point>();
  const kindOf = new Map(t.nodes.map((n) => [n.id, n.data.kind]));
  const apps = t.nodes.filter((n) => n.data.kind === 'app');
  let cursor = 0;

  for (const app of apps) {
    const crons = t.edges
      .filter((e) => e.kind === 'schedule' && e.target === app.id)
      .map((e) => e.source);
    const domains = t.edges
      .filter(
        (e) => e.kind === 'ingress' && e.target === app.id && kindOf.get(e.source) === 'domain'
      )
      .map((e) => e.source);
    // A shared database is placed with the first app that binds it.
    const resources = t.edges
      .filter(
        (e) =>
          (e.kind === 'storage' || e.kind === 'database') &&
          e.source === app.id &&
          !pos.has(e.target)
      )
      .map((e) => e.target)
      .filter((id, i, all) => all.indexOf(id) === i);

    crons.forEach((id, i) => pos.set(id, { x: COLUMN.app + 16, y: cursor + i * STACK }));
    const top = cursor + crons.length * STACK;
    const rows = Math.max(1, domains.length, resources.length);
    const height = rows * ROW - 20;
    pos.set(app.id, { x: COLUMN.app, y: top + (height - NODE_SIZE.app.h) / 2 });
    domains.forEach((id, i) => pos.set(id, { x: COLUMN.domain, y: top + i * ROW + 10 }));
    resources.forEach((id, i) => pos.set(id, { x: COLUMN.resource, y: top + i * ROW + 10 }));
    cursor = top + height + BAND_GAP;
  }

  // Databases nothing binds still exist; they sit in a final band.
  const loose = t.nodes.filter((n) => n.data.kind === 'postgres' && !pos.has(n.id));
  loose.forEach((n, i) => pos.set(n.id, { x: COLUMN.resource, y: cursor + i * ROW }));
  if (loose.length) cursor += loose.length * ROW + BAND_GAP;

  if (t.nodes.some((n) => n.id === nodeId.internet)) {
    pos.set(nodeId.internet, {
      x: COLUMN.internet,
      y: Math.max(0, (cursor - BAND_GAP) / 2 - NODE_SIZE.internet.h / 2),
    });
  }
  return pos;
}

/** Where the connect menu opens: below the app, on the side its "+" was pressed. */
export function menuPosition(app: Point, side: 'in' | 'out'): Point {
  return side === 'in'
    ? { x: app.x - 290, y: app.y + NODE_SIZE.app.h + 24 }
    : { x: app.x + NODE_SIZE.app.w + 60, y: app.y + NODE_SIZE.app.h + 24 };
}
