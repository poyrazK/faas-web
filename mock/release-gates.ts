import type { components } from '../src/lib/api/schema';
import * as db from './data';
import { checks, slos } from './notification-channels';
import { GuardProblem } from './release-freezes';

type S = components['schemas'];
export type Gate = S['ReleaseGate'];
type Create = Partial<S['CreateReleaseGateRequest']>;

/** Release gates (faas apidserver/release_gates.go, pkg/releasegate/request.go). */
const NAME = /^[a-z][a-z0-9_-]{0,62}$/;
const METRIC = /^[a-z][a-z0-9_]{0,62}$/;
const AI = ['error_rate', 'flagged_rate', 'cost_per_call', 'ttfb_ms'];
const MAX = 10;
const validation = (detail: string) => new GuardProblem(400, 'validation_failed', detail);
const between = (v: unknown, lo: number, hi: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

export const gates = new Map<string, Gate[]>(
  db.EMPTY
    ? []
    : [
        [
          db.apps[0].slug,
          [
            {
              name: 'checkout-slo',
              kind: 'slo',
              slo: 'availability',
              max_burn_rate: 10,
              min_samples: 20,
              created_by: db.account.email,
              created_at: db.iso(3 * 86_400_000),
            },
            {
              name: 'no-new-errors',
              kind: 'new_errors',
              max_new_groups: 0,
              min_events: 3,
              min_samples: 20,
              created_by: db.account.email,
              created_at: db.iso(2 * 86_400_000),
            },
          ],
        ],
      ]
);

export const list = (slug: string): Gate[] => gates.get(slug) ?? [];

/** releasegate.FromRequest, the target lookup and the per-app limit. */
export function create(slug: string, req: Create, actor: string, now = Date.now()): Gate {
  if (!NAME.test(req.name ?? ''))
    throw validation(
      "name must be 1-63 lowercase letters, digits, '-' or '_', starting with a letter"
    );
  const minSamples = req.min_samples ?? (req.kind === 'synthetic' ? 6 : 20);
  if (!between(minSamples, 1, 1_000_000)) throw validation('min_samples must be 1-1000000');
  const gate: Gate = {
    name: req.name!,
    kind: req.kind as Gate['kind'],
    min_samples: minSamples,
    created_by: actor,
    created_at: new Date(now).toISOString(),
  };
  switch (req.kind) {
    case 'slo':
      if (!req.slo) throw validation("an slo gate needs slo, the name of one of the app's SLOs");
      if (!(slos.get(slug) ?? []).some((s) => s.name === req.slo))
        throw validation(`the app has no SLO named ${req.slo}`);
      gate.slo = req.slo;
      gate.max_burn_rate = req.max_burn_rate ?? 10;
      if (!between(gate.max_burn_rate, 1, 1000)) throw validation('max_burn_rate must be 1-1000');
      break;
    case 'new_errors':
      gate.max_new_groups = req.max_new_groups ?? 0;
      gate.min_events = req.min_events ?? 3;
      if (!between(gate.max_new_groups, 0, 100)) throw validation('max_new_groups must be 0-100');
      if (!between(gate.min_events, 1, 100_000)) throw validation('min_events must be 1-100000');
      break;
    case 'custom_metric':
      if (!METRIC.test(req.metric ?? '')) throw validation('metric must be a custom metric name');
      if (req.comparison !== 'below' && req.comparison !== 'above')
        throw validation('comparison must be below or above');
      if (typeof req.threshold !== 'number' || !Number.isFinite(req.threshold))
        throw validation('a custom_metric gate needs a finite threshold');
      Object.assign(gate, {
        metric: req.metric,
        comparison: req.comparison,
        threshold: req.threshold,
      });
      break;
    case 'metric_change':
      if (!METRIC.test(req.metric ?? '')) throw validation('metric must be a custom metric name');
      if (req.comparison !== 'below' && req.comparison !== 'above')
        throw validation('comparison must be below or above');
      if (!between(req.max_change_percent, 1, 1000))
        throw validation('max_change_percent must be 1-1000');
      Object.assign(gate, {
        metric: req.metric,
        comparison: req.comparison,
        max_change_percent: req.max_change_percent,
      });
      break;
    case 'synthetic':
      if (!(checks.get(slug) ?? []).some((c) => c.name === req.check))
        throw validation(`the app has no synthetic check named ${req.check}`);
      gate.check = req.check;
      gate.max_failure_percent = req.max_failure_percent ?? 10;
      if (!between(gate.max_failure_percent, 0, 100))
        throw validation('max_failure_percent must be 0-100');
      break;
    case 'ai':
      if (!AI.includes(req.metric ?? ''))
        throw validation(`an ai gate's metric must be ${AI.join(', ')}`);
      gate.metric = req.metric;
      gate.max_increase_percent = req.max_increase_percent ?? 50;
      if (!between(gate.max_increase_percent, 1, 1000))
        throw validation('max_increase_percent must be 1-1000');
      break;
    default:
      throw validation(
        'kind must be slo, new_errors, custom_metric, ai, synthetic or metric_change'
      );
  }
  const current = list(slug);
  if (current.some((g) => g.name === gate.name))
    throw new GuardProblem(
      409,
      'validation_failed',
      `The app already has a release gate named ${gate.name}.`
    );
  if (current.length >= MAX)
    throw new GuardProblem(409, 'release_gate_limit', `An app can hold ${MAX} release gates.`);
  gates.set(
    slug,
    [...current, gate].sort((a, b) => a.name.localeCompare(b.name))
  );
  return gate;
}

export function remove(slug: string, name: string): Gate {
  const current = list(slug);
  const gate = current.find((g) => g.name === name);
  if (!gate)
    throw new GuardProblem(
      404,
      'release_gate_not_found',
      `The app has no release gate named ${name}.`
    );
  gates.set(
    slug,
    current.filter((g) => g !== gate)
  );
  return gate;
}
