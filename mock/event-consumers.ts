import type { components } from '../src/lib/api/schema';
import { apps, iso } from './data';
import { subscriptions } from './events';

/**
 * Dev-mock answers for an app's side of the event router: the subscriptions
 * its manifest declared, operator delivery controls (pause and paced resume),
 * the event deliveries it received, and each delivery's acknowledgment lease.
 * The subscriptions are the event router's own (`mock/events.ts`), so the
 * Router and App consumers views agree. `billing-recon` starts paused with a
 * backlog so resume has something to drain.
 */

type S = components['schemas'];
interface MockCtx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
}
type Register = (method: string, template: string, handler: (ctx: MockCtx) => unknown) => void;
type ProblemCtor = new (status: number, code: string, detail?: string) => Error;

const MINUTE = 60_000;

export function registerEventConsumerMocks(route: Register, Problem: ProblemCtor) {
  const appOf = (slug: string) => {
    const app = apps.find((entry) => entry.slug === slug);
    if (!app) throw new Problem(404, 'not_found', 'no such app');
    return app;
  };
  const subscriptionOf = (slug: string, id: string) => {
    const subscription = subscriptions.find(
      (entry) => entry.app.slug === appOf(slug).slug && entry.subscription_id === id
    );
    if (!subscription)
      throw new Problem(
        404,
        'not_found',
        'no matching subscription or retained control belongs to this app'
      );
    return subscription;
  };

  const controls = new Map<string, S['EventSubscriptionDeliveryControl']>();
  const controlOf = (slug: string, id: string) => {
    const subscription = subscriptionOf(slug, id);
    let control = controls.get(id);
    if (!control) {
      const paused = subscription.app.slug === 'billing-recon';
      control = {
        subscription_id: id,
        app_id: subscription.app.id,
        paused,
        rate_per_second: paused ? 10 : 0,
        pending_recipients: paused ? 42 : 0,
        processing_recipients: paused ? 0 : 1,
        oldest_age_seconds: paused ? 1260 : 0,
        ...(paused ? { oldest_pending_at: iso(21 * MINUTE), updated_at: iso(25 * MINUTE) } : {}),
        max_pending_deliveries: 0,
        effective_max_pending_deliveries: 64,
        live_deliveries: paused ? 0 : 1,
      };
      controls.set(id, control);
    }
    return control;
  };

  // Deliveries per app, newest first, seeded from each app's subscriptions.
  const STATES: Array<S['EventDeliveryResponse']['state']> = [
    'completed',
    'dispatching',
    'failed',
    'completed',
    'dead_letter',
    'pending',
    'completed',
  ];
  const deliveries = new Map<string, S['EventDeliveryResponse'][]>();
  const deliveriesOf = (slug: string) => {
    const app = appOf(slug);
    let list = deliveries.get(slug);
    if (!list) {
      const mine = subscriptions.filter((entry) => entry.app.slug === app.slug);
      list = mine.flatMap((subscription, s) =>
        STATES.map((state, i) => ({
          invocation_id: `7d1c${String(s).padStart(2, '0')}${String(i).padStart(2, '0')}-0b3a-4c2e-9f10-5e6d7c8b9a0f`,
          invocation_source: i === 6 ? ('replay' as const) : ('async_invoke' as const),
          event_id: `evt-${4100 + s * 10 + i}`,
          event_source: subscription.source,
          event_type: subscription.type.replace('*', 'paid'),
          subscription_id: subscription.subscription_id,
          state,
          attempts: state === 'failed' || state === 'dead_letter' ? 5 : 1,
          ...(state === 'failed' || state === 'dead_letter'
            ? { last_error: 'handler returned 500' }
            : {}),
          created_at: iso((s * 10 + i) * 7 * MINUTE),
          completed_at: state === 'completed' ? iso((s * 10 + i) * 7 * MINUTE - 2000) : null,
        }))
      );
      deliveries.set(slug, list);
    }
    return list;
  };

  route('GET', '/v1/apps/{slug}/event-subscriptions', ({ params }) => {
    const app = appOf(params.slug);
    return {
      app_slug: app.slug,
      subscriptions: subscriptions
        .filter((entry) => entry.app.slug === app.slug)
        .map((entry, i) => ({
          id: entry.subscription_id,
          app_id: app.id,
          source: entry.source,
          type: entry.type,
          filter: entry.filter,
          enabled: true,
          ordered: i === 0,
          created_at: iso(30 * 24 * 60 * MINUTE),
          updated_at: iso(2 * 24 * 60 * MINUTE),
        })),
    };
  });

  route(
    'GET',
    '/v1/apps/{slug}/event-subscriptions/{subscriptionID}/delivery-control',
    ({ params }) => controlOf(params.slug, params.subscriptionID)
  );

  route(
    'POST',
    '/v1/apps/{slug}/event-subscriptions/{subscriptionID}/delivery-control/pause',
    ({ params }) => {
      const control = controlOf(params.slug, params.subscriptionID);
      Object.assign(control, { paused: true, updated_at: new Date().toISOString() });
      return control;
    }
  );

  route(
    'POST',
    '/v1/apps/{slug}/event-subscriptions/{subscriptionID}/delivery-control/resume',
    ({ params, body }) => {
      const control = controlOf(params.slug, params.subscriptionID);
      const rate = body.rate_per_second ?? 10;
      if (typeof rate !== 'number' || !Number.isInteger(rate) || rate < 0 || rate > 100)
        throw new Problem(400, 'validation_failed', 'rate must be between 0 and 100');
      Object.assign(control, {
        paused: false,
        rate_per_second: rate,
        updated_at: new Date().toISOString(),
      });
      return control;
    }
  );

  route('GET', '/v1/apps/{slug}/event-deliveries', ({ params, query }) => {
    const state = query.get('state');
    const limit = Math.min(Number(query.get('limit')) || 20, 200);
    const all = deliveriesOf(params.slug).filter((entry) => !state || entry.state === state);
    const before = query.get('before');
    const start = before ? Number(before) : 0;
    const page = all.slice(start, start + limit);
    const first = subscriptions.find((entry) => entry.app.slug === params.slug);
    return {
      app_slug: params.slug,
      deliveries: page,
      ...(start + limit < all.length ? { next_before: String(start + limit) } : {}),
      fanout_failures:
        first && !state && !before
          ? [
              {
                event_id: 'evt-4099',
                event_source: first.source,
                event_type: first.type.replace('*', 'paid'),
                subscription_id: first.subscription_id,
                state: 'failed' as const,
                attempts: 12,
                failure_code: 'target_unavailable',
                retryable: true,
                last_error: 'target app unavailable',
                created_at: iso(5 * 60 * MINUTE),
                failed_at: iso(4 * 60 * MINUTE),
              },
            ]
          : [],
    };
  });

  route('GET', '/v1/apps/{slug}/event-deliveries/{invocationID}/acknowledgment', ({ params }) => {
    const delivery = deliveriesOf(params.slug).find(
      (entry) => entry.invocation_id === params.invocationID
    );
    if (!delivery) throw new Problem(404, 'not_found', 'no such event delivery');
    const processing: Record<string, S['EventAcknowledgmentStatus']['processing_state']> = {
      pending: 'waiting',
      dispatching: 'processing',
      completed: 'completed',
      failed: 'failed',
      dead_letter: 'dead_letter',
      cancelled: 'cancelled',
      superseded: 'superseded',
      expired: 'expired',
    };
    const live = delivery.state === 'dispatching';
    return {
      invocation_id: delivery.invocation_id,
      attempt: delivery.attempts,
      replay_generation: delivery.invocation_source === 'replay' ? 1 : 0,
      state: delivery.state,
      processing_state: processing[delivery.state],
      ...(live
        ? {
            lease_expires_at: new Date(Date.now() + 4 * MINUTE).toISOString(),
            deadline_at: new Date(Date.now() + 55 * MINUTE).toISOString(),
          }
        : {}),
      ...(delivery.state === 'failed'
        ? {
            disposition: 'retry' as const,
            failure_reason: 'upstream_timeout',
            next_attempt_at: new Date(Date.now() + 3 * MINUTE).toISOString(),
          }
        : {}),
      ...(delivery.state === 'dead_letter'
        ? { disposition: 'dead-letter' as const, failure_reason: 'invalid_payload' }
        : {}),
    };
  });
}
