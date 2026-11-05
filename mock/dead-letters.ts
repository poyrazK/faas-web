import type { components } from '../src/lib/api/schema';
import { apps, EMPTY, id, iso } from './data';

/**
 * Dev-mock answers for an app's unified dead-letter ledger
 * (`/v1/apps/{slug}/dlq`, faas docs/dead-letters.md). Every source the ledger
 * holds is seeded on the first app so each status renders: a waiting
 * invocation, a trigger record, a webhook delivery, an event subscription
 * delivery, an already replayed entry and an event_route entry that cannot
 * be replayed. Replay stamps `replayed_at` and is refused the second time the
 * way the store refuses it (no open entry: 404); purge only removes the
 * ledger projection.
 */

type DeadLetterEvent = components['schemas']['DeadLetterEvent'];
interface MockCtx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
}
type Register = (method: string, template: string, handler: (ctx: MockCtx) => unknown) => void;
type ProblemCtor = new (status: number, code: string, detail?: string) => Error;

const HOUR = 3_600_000;
const status = (code: number, body: unknown) => ({ __status: code, body });

function seed(app: (typeof apps)[number]): DeadLetterEvent[] {
  const entry = (
    source: DeadLetterEvent['source'],
    ago: number,
    rest: Partial<DeadLetterEvent>
  ): DeadLetterEvent => ({
    id: id(),
    app_id: app.id,
    app_slug: app.slug,
    source,
    source_id: id(),
    payload: { order_id: 4200 + Math.round(ago / HOUR), total_cents: 1299 },
    headers: { 'content-type': 'application/json' },
    error_kind: 'handler_error',
    error_detail: { status: 500, message: 'handler returned 500' },
    retry_count: 5,
    first_failed_at: iso(ago + HOUR),
    last_failed_at: iso(ago),
    replayed_at: null,
    created_at: iso(ago),
    ...rest,
  });
  return [
    entry('invocation', 0.2 * HOUR, { origin: 'queue' }),
    entry('trigger_record', 1 * HOUR, {
      origin: 'kafka',
      trigger_id: id(),
      error_kind: 'max_attempts',
      retry_count: 10,
    }),
    entry('webhook_delivery', 3 * HOUR, {
      origin: 'webhook',
      error_kind: 'http_503',
      error_detail: { status: 503, endpoint: 'https://hooks.example.com/orders' },
    }),
    entry('invocation', 6 * HOUR, { origin: 'event_subscription', retry_count: 8 }),
    entry('invocation', 20 * HOUR, { origin: 'async', replayed_at: iso(19 * HOUR) }),
    entry('event_route', 30 * HOUR, {
      origin: 'event_route',
      error_kind: 'target_unavailable',
      error_detail: { failure_code: 'target_unavailable' },
      retry_count: 12,
      payload: { source: 'billing', id: 'evt-route-lost', type: 'invoice.paid' },
    }),
  ];
}

export function registerDeadLetterMocks(route: Register, Problem: ProblemCtor, noContent: symbol) {
  const ledgers = new Map<string, DeadLetterEvent[]>(
    apps.map((app, i) => [app.slug, EMPTY || i > 0 ? [] : seed(app)])
  );
  const ledgerOf = (slug: string) => {
    const ledger = ledgers.get(slug);
    if (!ledger) throw new Problem(404, 'not_found', 'no such app');
    return ledger;
  };
  const limitOf = (query: URLSearchParams, fallback: number) => {
    const raw = query.get('limit');
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 200)
      throw new Problem(400, 'bad_request', 'limit must be between 1 and 200');
    return n;
  };
  const find = (slug: string, eventId: string) => {
    const event = ledgerOf(slug).find((entry) => entry.id === eventId);
    if (!event)
      throw new Problem(
        404,
        'not_found',
        `no dead-letter event with id "${eventId}" belongs to this app.`
      );
    return event;
  };
  const open = (event: DeadLetterEvent) => !event.replayed_at && event.source !== 'event_route';

  route('GET', '/v1/apps/{slug}/dlq', ({ params, query }) => {
    const ledger = ledgerOf(params.slug);
    const limit = Math.min(Number(query.get('limit')) || 20, 200);
    const before = query.get('before');
    const start = before ? ledger.findIndex((entry) => entry.id === before) + 1 : 0;
    const page = ledger.slice(start, start + limit);
    return {
      app_slug: params.slug,
      events: page,
      ...(page.length === limit && start + limit < ledger.length
        ? { next_before: page[page.length - 1].id }
        : {}),
    };
  });

  route('GET', '/v1/apps/{slug}/dlq/{id}', ({ params }) => find(params.slug, params.id));

  route('POST', '/v1/apps/{slug}/dlq/{id}/replay', ({ params }) => {
    const event = find(params.slug, params.id);
    if (event.source === 'event_route')
      throw new Problem(
        409,
        'dead_letter_not_replayable',
        "this routing failure's receipt has been pruned, so there is nothing to redrive; re-publish the event in its payload to deliver it again."
      );
    if (event.replayed_at)
      throw new Problem(404, 'not_found', 'no open dead-letter event with that id');
    event.replayed_at = new Date().toISOString();
    return status(202, event);
  });

  route('POST', '/v1/apps/{slug}/dlq:replay_all', ({ params, query }) => {
    const limit = limitOf(query, 200);
    const waiting = ledgerOf(params.slug).filter(open).slice(0, limit);
    const at = new Date().toISOString();
    for (const event of waiting) event.replayed_at = at;
    return status(202, { app_slug: params.slug, replayed: waiting.length });
  });

  route('DELETE', '/v1/apps/{slug}/dlq/{id}', ({ params }) => {
    const ledger = ledgerOf(params.slug);
    const event = find(params.slug, params.id);
    ledger.splice(ledger.indexOf(event), 1);
    return noContent;
  });

  route('DELETE', '/v1/apps/{slug}/dlq', ({ params, query }) => {
    const ledger = ledgerOf(params.slug);
    const purged = ledger.splice(0, limitOf(query, 200)).length;
    return { app_slug: params.slug, purged };
  });
}
