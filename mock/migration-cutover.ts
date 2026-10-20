import type { components } from '../src/lib/api/schema';
import * as db from './data';

type Plan = components['schemas']['MigrationCutover'];
type Request = components['schemas']['CreateMigrationCutoverRequest'];
type Verification = components['schemas']['MigrationVerification'];
type Route = (
  method: string,
  path: string,
  handler: (context: { params: Record<string, string>; body: Record<string, unknown> }) => unknown
) => void;

export function registerMigrationCutover(
  route: Route,
  Problem: new (status: number, code: string, detail?: string) => Error,
  verification: (slug: string, id: string) => Verification | undefined
) {
  const plans = new Map<string, Plan>();
  const bindings = new Map<string, string>();
  const fail = (status: number, code: string, detail: string): never => {
    throw new Problem(status, code, detail);
  };
  function refresh(plan: Plan) {
    if (plan.status === 'restored' || plan.status === 'cancelled') return plan;
    const run = verification(plan.app, plan.request.verification_id);
    if (
      !run ||
      run.status !== 'passed' ||
      run.deployment_id !== plan.deployment_id ||
      run.configuration_revision !== plan.configuration_revision
    ) {
      plan.status = 'blocked';
      plan.reason = 'deployment_or_configuration_changed';
      return plan;
    }
    const app = db.appBySlug(plan.app);
    const domain = db.domains.find((item) => item.domain === plan.request.hostname);
    plan.domain_connected = !!domain && domain.app_id === app?.id && !domain.environment;
    if (
      (domain && !plan.domain_connected) ||
      (bindings.has(plan.id) && bindings.get(plan.id) !== domain?.challenge_token)
    ) {
      plan.status = 'blocked';
      plan.reason = 'domain_binding_changed';
      return plan;
    }
    plan.dns_records =
      plan.domain_connected && domain
        ? [
            {
              type: 'TXT',
              name: `_gregale-challenge.${domain.domain}`,
              value: domain.challenge_token ?? 'verified',
              purpose: 'verification',
            },
            { type: 'CNAME', name: domain.domain, value: 'edge.gregale.dev', purpose: 'routing' },
          ]
        : [];
    if (plan.status === 'checking' || plan.status === 'ready') {
      if (Date.now() >= Date.parse(plan.check_deadline!)) {
        plan.status = 'attention';
        plan.reason = 'check_deadline_reached';
      } else if (Date.now() - Date.parse(plan.started_at!) >= 2000) {
        plan.status = 'ready';
        delete plan.reason;
        plan.hostname_verified_at ??= new Date(Date.parse(plan.started_at!) + 2000).toISOString();
        plan.checked_at = new Date().toISOString();
        plan.checks = [
          { name: 'ownership', status: 'passed', detail: 'Domain ownership verified (mock).' },
          { name: 'dns_routing', status: 'passed', detail: 'Routing points to Gregale (mock).' },
          {
            name: 'tls',
            status: 'passed',
            detail: 'Trusted HTTPS certificate for this hostname (mock).',
          },
          {
            name: 'deployment_route',
            status: 'passed',
            detail:
              'This production hostname returned 2xx with gateway proof for the selected deployment (mock).',
          },
        ];
        plan.traffic = {
          status: 'unknown',
          coverage: 'deployment_route_observed_only',
          reason: 'insufficient_requests',
          requests: 0,
          server_errors: 0,
          checked_at: plan.checked_at,
        };
      }
    }
    return plan;
  }
  function owned(slug: string, id: string) {
    const plan = plans.get(id);
    return plan?.app === slug ? refresh(plan) : fail(404, 'not_found', 'No such cutover plan.');
  }
  route('GET', '/v1/apps/{slug}/migration-cutovers', ({ params }) => ({
    plans: [...plans.values()]
      .filter((plan) => plan.app === params.slug)
      .reverse()
      .map(refresh),
  }));
  route('GET', '/v1/apps/{slug}/migration-cutovers/{plan}', ({ params }) =>
    owned(params.slug, params.plan)
  );
  route('POST', '/v1/apps/{slug}/migration-cutovers', ({ params, body }) => {
    const input = body as unknown as Request;
    if (plans.has(input.id)) {
      const existing = owned(params.slug, input.id);
      if (JSON.stringify(existing.request) !== JSON.stringify(input))
        return fail(409, 'conflict', 'The saved plan has different intent.');
      return existing;
    }
    const run = verification(params.slug, input.verification_id);
    if (run?.status !== 'passed' || run.scope !== 'default')
      return fail(400, 'validation_failed', 'Verify the current deployment first.');
    if (
      !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(input.hostname) ||
      !input.previous_records?.length ||
      input.previous_records.some(
        (record) =>
          !['CNAME', 'A', 'AAAA'].includes(record.type) ||
          (/[\s/:?@#]/.test(record.value) && record.type !== 'AAAA') ||
          record.ttl < 0
      )
    )
      return fail(400, 'validation_failed', 'Review the hostname and routing records.');
    const plan: Plan = {
      id: input.id,
      app: params.slug,
      deployment_id: run.deployment_id,
      configuration_revision: run.configuration_revision,
      smoke_path: run.request.smoke_path,
      status: 'prepared',
      request: structuredClone(input),
      domain_connected: false,
      dns_records: [],
      checks: [],
      traffic: {
        status: 'unknown',
        coverage: 'deployment_route_observed_only',
        reason: 'checks_not_started',
        requests: 0,
        server_errors: 0,
      },
      created_at: new Date().toISOString(),
      limited_traffic_acknowledged: false,
    };
    refresh(plan);
    plans.set(plan.id, plan);
    const domain = db.domains.find((item) => item.domain === input.hostname);
    if (plan.domain_connected && domain?.challenge_token)
      bindings.set(plan.id, domain.challenge_token);
    return plan;
  });
  route('POST', '/v1/apps/{slug}/migration-cutovers/{plan}/actions', ({ params, body }) => {
    const plan = owned(params.slug, params.plan);
    const action = String(body.action);
    if (action === 'cancel' || action === 'confirm_restored') {
      plan.status = action === 'cancel' ? 'cancelled' : 'restored';
      delete plan.reason;
      plan.completed_at = new Date().toISOString();
      return plan;
    }
    if (action === 'start_checks') {
      if (plan.status === 'checking' || plan.status === 'ready') return plan;
      if (!plan.domain_connected || !['prepared', 'attention'].includes(plan.status))
        return fail(400, 'validation_failed', 'Connect the domain before starting checks.');
      plan.status = 'checking';
      plan.started_at = new Date().toISOString();
      plan.check_deadline = new Date(Date.now() + 1800000).toISOString();
      delete plan.reason;
      delete plan.hostname_verified_at;
      const domain = db.domains.find((item) => item.domain === plan.request.hostname);
      if (domain?.challenge_token) bindings.set(plan.id, domain.challenge_token);
      return plan;
    }
    if (action === 'complete') {
      if (plan.status === 'completed') return plan;
      if (plan.status !== 'ready')
        return fail(409, 'conflict', 'Wait for hostname checks to pass.');
      if (plan.traffic.status !== 'healthy' && !body.acknowledge_limited_traffic)
        return fail(400, 'validation_failed', 'Acknowledge limited traffic evidence.');
      plan.status = 'completed';
      plan.completed_at = new Date().toISOString();
      plan.limited_traffic_acknowledged = plan.traffic.status !== 'healthy';
      return plan;
    }
    return fail(400, 'validation_failed', 'Unknown cutover action.');
  });
}
