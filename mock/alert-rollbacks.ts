import { randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';
import * as db from './data';
import { GuardProblem } from './release-freezes';

type Rollback = components['schemas']['AlertRollback'];

/**
 * Alert rollback receipts (faas handlers_alert_rollbacks.go): one completed
 * canary rollback and one held by a bindings blocker on the first app, so
 * the list and both kinds of receipt have something to show.
 */
const first = db.apps[0];
const deploymentsOf = db.deployments.filter((d) => d.app_id === first?.id);
const at = (msAgo: number) => db.iso(msAgo);

export const rollbacks: Rollback[] =
  db.EMPTY || !first
    ? []
    : [
        {
          id: randomUUID(),
          rule_id: randomUUID(),
          account_id: db.ACCOUNT_ID,
          app_id: first.id,
          scope: 'default',
          candidate_deployment_id: deploymentsOf[1]?.id,
          predecessor_deployment_id: deploymentsOf[2]?.id,
          status: 'blocked',
          reason: 'error_rate_pct > 5 over 5m',
          code: 'binding_verification_stale',
          blockers: [
            {
              code: 'binding_verification_stale',
              binding: 'orders-db',
              message:
                'The predecessor’s binding check is older than its maximum age; Gregale retries with fresh evidence.',
            },
          ],
          rollback_phase: 'blocked',
          observed_value: 7.4,
          fired_at: at(12 * 60_000),
          updated_at: at(60_000),
        },
        {
          id: randomUUID(),
          rule_id: randomUUID(),
          account_id: db.ACCOUNT_ID,
          app_id: first.id,
          scope: 'default',
          candidate_deployment_id: deploymentsOf[3]?.id,
          predecessor_deployment_id: deploymentsOf[4]?.id,
          historical: true,
          status: 'complete',
          reason: 'error_rate_pct > 2 over 5m',
          rollback_phase: 'complete',
          rollback_operation_id: randomUUID(),
          deployment_evidence: {
            version: 1,
            deployment_id: deploymentsOf[3]?.id ?? randomUUID(),
            metric: 'error_rate_pct',
            comparison: 'gt',
            threshold: 2,
            window_spec: '5m',
            cutover_at: at(3 * 86_400_000 + 9 * 60_000),
            window_start: at(3 * 86_400_000 + 8 * 60_000),
            window_end: at(3 * 86_400_000 + 3 * 60_000),
            requests: 412,
            server_errors: 19,
            minimum_requests: 20,
            error_rate_pct: (19 / 412) * 100,
            status: 'breached',
          },
          observed_value: 4.6,
          fired_at: at(3 * 86_400_000 + 3 * 60_000),
          updated_at: at(3 * 86_400_000),
          completed_at: at(3 * 86_400_000),
        },
      ];

export const list = (appId: string) =>
  rollbacks
    .filter((r) => r.app_id === appId)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, 32);

export function get(appId: string, fire: string): Rollback {
  if (!/^[0-9a-f-]{36}$/i.test(fire))
    throw new GuardProblem(422, 'validation_failed', 'fire must be an alert delivery UUID');
  const r = rollbacks.find((x) => x.id === fire && x.app_id === appId);
  if (!r) throw new GuardProblem(404, 'not_found', 'no such alert rollback for this app');
  return r;
}
