import { ApiError, errorMessage } from '@/lib/api/errors';
import { useOrgBillingStatus, useOrgUsage } from '@/lib/api/org-billing';
import { useOrgApps } from '@/lib/api/workspace-apps';
import { InlinePhase, Panel, queryPhase } from './primitives';

/**
 * A company's billing reads, for a company workspace. The personal Usage and
 * Plans pages read the signed-in account; these read the organization's own
 * billing subject (GET /v1/orgs/{slug}/…), which the same apid handlers serve.
 */

/** The role refusal in words that name the organization (faas authz org_role_forbidden). */
export function orgBillingMessage(err: unknown, label: string, what: string): string {
  if (err instanceof ApiError && err.code === 'org_role_forbidden')
    return `Only ${label}'s owners and billing admins can see its ${what}.`;
  return errorMessage(err);
}

const gbHours = (mbSeconds: number) =>
  (mbSeconds / 1024 / 3600).toLocaleString(undefined, { maximumFractionDigits: 2 });

export function OrgUsage({ org, label }: { org: string; label: string }) {
  const usage = useOrgUsage(org);
  const apps = useOrgApps(org);
  // Usage rows carry app ids; the organization's app list names them.
  const slugs = new Map((apps.data?.apps ?? []).map((app) => [app.id, app.slug]));
  const rows = usage.data ?? [];
  const phase = queryPhase({ loading: usage.isPending, error: usage.error, isEmpty: !rows.length });
  return (
    <Panel
      title={`${label} usage this month`}
      description="Application usage billed to the organization. Usage from before an app joined it stays with its original owner."
    >
      {usage.error ? (
        <p role="status" className="text-sm text-muted-foreground">
          {orgBillingMessage(usage.error, label, 'usage')}
        </p>
      ) : (
        <InlinePhase
          phase={phase}
          error={usage.error}
          emptyMessage="No application usage this month."
          onRetry={() => void usage.refetch()}
        />
      )}
      {phase === 'ready' && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="label-mono text-left text-muted-foreground">
                <th className="py-2 font-normal">App</th>
                <th className="py-2 text-right font-normal whitespace-nowrap">GB-hours</th>
                <th className="py-2 text-right font-normal">Requests</th>
                <th className="py-2 text-right font-normal whitespace-nowrap">Cold boots</th>
              </tr>
            </thead>
            <tbody className="[font-variant-numeric:tabular-nums]">
              {rows.map((row) => (
                <tr key={row.app_id} className="border-t border-border">
                  <td className="py-2 font-mono text-xs">{slugs.get(row.app_id) ?? row.app_id}</td>
                  <td className="py-2 text-right">{gbHours(row.mb_seconds ?? 0)}</td>
                  <td className="py-2 text-right">{(row.requests ?? 0).toLocaleString()}</td>
                  <td className="py-2 text-right">{(row.cold_boots ?? 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

const PLAN_NAMES: Record<string, string> = {
  free: 'Free',
  hobby: 'Hobby',
  pro: 'Pro',
  scale: 'Scale',
};

export function OrgPlanSummary({ org, label }: { org: string; label: string }) {
  const status = useOrgBillingStatus(org);
  const phase = queryPhase({ loading: status.isPending, error: status.error });
  const plan = status.data?.plan;
  return (
    <Panel
      title={`${label}'s plan`}
      description="The organization pays for its own apps. Its owner changes the plan."
    >
      {status.error ? (
        <p role="status" className="text-sm text-muted-foreground">
          {orgBillingMessage(status.error, label, 'plan')}
        </p>
      ) : (
        <InlinePhase phase={phase} error={status.error} onRetry={() => void status.refetch()} />
      )}
      {phase === 'ready' && plan && (
        <p className="text-sm text-foreground">
          {label} is on the {PLAN_NAMES[plan] ?? plan} plan.
        </p>
      )}
    </Panel>
  );
}
