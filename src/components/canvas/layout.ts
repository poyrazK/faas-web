import type { CanvasNodeKind, Topology } from './topology';
import type { CreateKind } from './create';
import type { ConnectSide } from './nodes';
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

/** An app mid-first-deploy shows its rail, so it is taller. */
export const APP_TALL = 96;
/** A failed first deploy also shows its cause and two actions. */
export const APP_FAILED = 120;
export const DRAFT_SIZE: Record<CreateKind, { w: number; h: number }> = {
  domain: { w: 230, h: 104 },
  bucket: { w: 230, h: 104 },
  cron: { w: 230, h: 212 },
};
export type DraftSlot = { app: string; side: ConnectSide; kind: CreateKind };

export const GHOST_SIZE = { w: 180, h: 44 };
/**
 * Where each next-step suggestion sits around an app: in the lane its real
 * node would use. The cron one takes the slot a first cron would, which
 * `layout(t, { ghostRoom })` keeps free above the app.
 */
export function ghostPositions(app: Point): Record<CreateKind, Point> {
  const across = (NODE_SIZE.app.h - GHOST_SIZE.h) / 2;
  return {
    domain: { x: COLUMN.domain, y: app.y + across },
    cron: {
      x: COLUMN.app + (NODE_SIZE.app.w - GHOST_SIZE.w) / 2,
      y: app.y - STACK + (STACK - 16 - GHOST_SIZE.h) / 2,
    },
    bucket: { x: COLUMN.resource, y: app.y + across },
  };
}
const DRAFT_GAP = 16;

export function layout(
  t: Topology,
  opts: {
    draft?: DraftSlot;
    heights?: ReadonlyMap<string, number>;
    /** An app with next-step ghosts: one cron slot is kept free above it. */
    ghostRoom?: string;
  } = {}
): Map<string, Point> {
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
    const room = opts.ghostRoom === app.id && !crons.length ? STACK : 0;
    const top = cursor + crons.length * STACK + room;
    const appH = opts.heights?.get(app.id) ?? NODE_SIZE.app.h;
    const rows = Math.max(1, domains.length, resources.length);
    const height = Math.max(rows * ROW - 20, appH);
    pos.set(app.id, { x: COLUMN.app, y: top + (height - appH) / 2 });
    domains.forEach((id, i) => pos.set(id, { x: COLUMN.domain, y: top + i * ROW + 10 }));
    resources.forEach((id, i) => pos.set(id, { x: COLUMN.resource, y: top + i * ROW + 10 }));
    let bandBottom = top + height;
    // An open draft takes real room under its app, so nothing is covered.
    if (opts.draft?.app === app.id) {
      const size = DRAFT_SIZE[opts.draft.kind];
      pos.set('draft', {
        x:
          opts.draft.side === 'in'
            ? COLUMN.domain - (size.w - NODE_SIZE.domain.w)
            : COLUMN.resource,
        y: bandBottom + DRAFT_GAP,
      });
      bandBottom += DRAFT_GAP + size.h;
    }
    cursor = bandBottom + BAND_GAP;
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
