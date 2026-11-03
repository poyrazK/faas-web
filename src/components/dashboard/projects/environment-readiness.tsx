import { useRef, useState } from 'react';
import {
  usePromotionPreview,
  usePromotionHistory,
  usePromotionReceipt,
  useApprovalReceipt,
  canonicalApprovalId,
  type EnvironmentIdentity,
  type PromotionFilters,
} from '@/lib/api/environment-readiness';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api/errors';
import { usePromoteEnvironment, useRollbackPromotion } from '@/lib/api/environments';
import { cliEnvironmentGitopsExplainCommand } from '@/lib/cli-commands';
import { CliCommand } from '../cli-command';
import { Panel } from '../primitives';

export type ReadinessSearch = {
  promotion?: string;
  approval?: string;
  promotionBefore?: string;
  promotionStatus?: PromotionFilters['status'];
};
export const validApprovalId = (value: string) => Boolean(canonicalApprovalId(value));

type Toast = { kind: 'info' | 'error'; title: string; description?: string; error?: unknown };

/**
 * What a refused promotion means, by the stable code
 * (handlers_project_environment_promotion.go:636-760, release_approvals.go,
 * release_freezes.go, project_promotion_admission.go).
 */
export function promotionFailure(error: unknown): Toast {
  const code = error instanceof ApiError ? error.code : '';
  switch (code) {
    case 'project_environment_approval_invalid':
      return {
        kind: 'info',
        title: 'The preview is out of date',
        description:
          'The live releases or configuration changed since this preview. Review the fresh preview and promote again.',
      };
    case 'release_approval_self':
      return { kind: 'error', title: 'Someone else must approve', error };
    case 'release_approval_canary_required':
      return { kind: 'error', title: 'An app needs more approvals than a promotion gives', error };
    case 'release_frozen':
      return { kind: 'error', title: 'A deploy freeze covers an app', error };
    case 'project_promotion_queue_full':
      return {
        kind: 'info',
        title: 'Promotions are queued up',
        description: 'Nothing was started. Try again in a few minutes.',
        error,
      };
    case 'validation_failed':
      return { kind: 'error', title: 'Promotion is blocked', error };
    default:
      return { kind: 'error', title: 'Promotion did not start', error };
  }
}
function Identity({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono text-xs">{value ?? 'Not returned'}</dd>
    </div>
  );
}
export function EnvironmentReadiness({
  identity,
  source,
  operation,
  approval,
  before,
  status,
  onSearch,
}: {
  identity: EnvironmentIdentity;
  source?: string;
  operation?: string;
  approval?: string;
  before?: string;
  status?: PromotionFilters['status'];
  onSearch: (patch: ReadinessSearch) => void;
}) {
  const preview = usePromotionPreview(identity, source ?? '');
  const history = usePromotionHistory(identity, { source, status, before });
  const receipt = usePromotionReceipt(identity, operation ?? '');
  const approvalReceipt = useApprovalReceipt(identity, approval ?? '');
  const [approvalDraft, setApprovalDraft] = useState('');
  const [approvalError, setApprovalError] = useState('');
  const confirm = useConfirm();
  const { toast } = useToast();
  const scope = { accountId: identity.accountId, slug: identity.project, org: null };
  const promote = usePromoteEnvironment(scope, identity.target);
  const rollback = useRollbackPromotion(scope, identity.target);
  // One key per reviewed promotion: retrying after a dropped response resumes
  // the same operation instead of starting a second one.
  const keys = useRef(new Map<string, string>());
  const p =
    !preview.error &&
    !preview.isFetching &&
    preview.data?.project_slug === identity.project &&
    preview.data.to_environment === identity.target &&
    preview.data.from_environment === source
      ? preview.data
      : undefined;
  const r =
    !receipt.error &&
    !receipt.isFetching &&
    receipt.data?.project_slug === identity.project &&
    receipt.data.promotion_id === operation &&
    receipt.data.to_environment === identity.target
      ? receipt.data
      : undefined;
  const a =
    !approvalReceipt.error &&
    !approvalReceipt.isFetching &&
    approvalReceipt.data?.environment === identity.target &&
    approvalReceipt.data.approval_id === approval
      ? approvalReceipt.data
      : undefined;
  const onPromote = async (plan: NonNullable<typeof p>) => {
    const changing = plan.changes.filter((c) => c.kind !== 'unchanged').length;
    if (
      !(await confirm({
        title: `Promote ${plan.from_environment} to ${plan.to_environment}?`,
        description: `${changing} of ${plan.changes.length} workload${plan.changes.length === 1 ? '' : 's'} change: ${plan.to_environment} starts serving the releases live in ${plan.from_environment}. ${plan.approval_required ? `${plan.to_environment} is protected, so this also approves this exact promotion as you. ` : ''}The target keeps its own configuration and secrets. If verification after cutover fails, the promotion rolls back by itself.`,
        confirmLabel: plan.approval_required ? 'Approve and promote' : 'Promote',
      }))
    )
      return;
    const key = keys.current.get(plan.promotion_hash) ?? crypto.randomUUID();
    keys.current.set(plan.promotion_hash, key);
    try {
      const result = await promote.mutateAsync({
        source: plan.from_environment,
        promotionToken: plan.promotion_token,
        approve: plan.approval_required,
        key,
      });
      toast(
        result.status === 'failed'
          ? {
              kind: 'error',
              title: 'Promotion failed',
              description: 'Its operation below says what was restored.',
            }
          : {
              kind: 'success',
              title: result.status === 'running' ? 'Promotion accepted' : 'Promoted',
              description:
                result.status === 'running'
                  ? 'Destination health is checked before cutover. Follow the operation below.'
                  : undefined,
            }
      );
      onSearch({ promotion: result.promotion_id });
    } catch (err) {
      toast(promotionFailure(err));
      if (err instanceof ApiError && err.code === 'project_environment_approval_invalid')
        void preview.refetch();
    }
  };
  const onRollback = async (promotion: string, from: string) => {
    if (
      !(await confirm({
        title: `Roll back the promotion from ${from}?`,
        description: `Each workload in ${identity.target} returns to the deployment it served before this promotion, and workloads the promotion created are taken out of traffic. It is refused if ${identity.target} changed since.`,
        confirmLabel: 'Roll back',
        destructive: true,
      }))
    )
      return;
    try {
      await rollback.mutateAsync({ promotion });
      toast({ kind: 'success', title: 'Promotion rolled back' });
      void receipt.refetch();
    } catch (err) {
      const changed = err instanceof ApiError && err.code === 'conflict';
      toast({
        kind: 'error',
        title: changed ? `${identity.target} changed since the promotion` : 'Rollback failed',
        description: changed ? 'Nothing was restored. Review what serves now first.' : undefined,
        error: err,
      });
    }
  };
  return (
    <div className="space-y-5">
      <Panel
        title="Promotion"
        description="Preview, approve and promote the source's live releases into this environment, and inspect recorded promotions."
      >
        <div className="space-y-4 p-4 text-sm">
          <p>
            Promotion moves the source&apos;s live releases into {identity.target}. Configuration
            and secrets stay {identity.target}&apos;s own, every promoted artifact is verified after
            cutover, and a failed verification rolls the promotion back on its own. Complete clones
            and GitOps are managed from the CLI.
          </p>
          <CliCommand
            command={cliEnvironmentGitopsExplainCommand(identity.project, identity.target)}
            label="GitOps source, approvals and serving progress"
            copyLabel={`GitOps explain command for ${identity.target}`}
          />
          {!source ? (
            <p>Select Compare from above to inspect an exact source-to-target preview.</p>
          ) : preview.error ? (
            <div role="alert">
              <p>
                Current promotion preview could not be read. Permission, MFA, changed context or
                unavailable contracts may require attention. Previous evidence is not current
                approval.
              </p>
              <Button variant="outline" onClick={() => void preview.refetch()}>
                Refresh preview
              </Button>
            </div>
          ) : preview.isPending || preview.isFetching ? (
            <p role="status">Reading current promotion preview…</p>
          ) : p ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>
                  {p.from_environment} → {p.to_environment} ·{' '}
                  {p.approval_required
                    ? 'Approval required'
                    : 'Approval not required by this preview'}
                </p>
                <Button variant="outline" onClick={() => void preview.refetch()}>
                  Refresh preview
                </Button>
              </div>
              <p>
                {p.can_promote
                  ? 'Server preview records no promotion blockers.'
                  : 'Server preview blocks promotion.'}{' '}
                This does not establish complete resource coverage or execution health. Changed
                source or target needs a fresh preview and review.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={!p.can_promote || promote.isPending}
                  onClick={() => void onPromote(p)}
                >
                  Promote {p.from_environment} to {p.to_environment}
                </Button>
                {p.approval_required && (
                  <span className="text-xs text-muted-foreground">
                    Protected: promoting approves this exact preview as you.
                  </span>
                )}
              </div>
              {!!p.blocking_reasons.length && (
                <ul aria-label="Promotion blockers" className="list-disc pl-5">
                  {p.blocking_reasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              )}
              <dl className="grid gap-3 sm:grid-cols-2">
                <Identity label="Promotion hash" value={p.promotion_hash} />
                <Identity label="Source configuration version" value={p.config.fromVersion} />
                <Identity label="Target configuration version" value={p.config.toVersion} />
                <Identity label="Source configuration hash" value={p.config.sourceHash} />
                <Identity label="Target configuration hash" value={p.config.targetHash} />
                <Identity label="Source release set" value={p.sourceRelease?.id} />
                <Identity label="Target release set" value={p.targetRelease?.id} />
              </dl>
              <p>
                Configuration stays target-scoped in this preview. Secrets and managed credentials
                remain target-owned; shared resource references do not establish isolated copies.
                Missing generation or serving receipts are not inferred.
              </p>
              {p.qualification ? (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <p>
                    Qualification: {p.qualification.id} · {p.qualification.status}
                  </p>
                  <p>
                    Returned expiry: <code>{p.qualification.expires_at}</code>. Receipt status alone
                    does not establish current qualification; use the fresh preview blockers.
                  </p>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <Identity
                      label="Qualified release set"
                      value={p.qualification.release_set_id}
                    />
                    <Identity
                      label="Qualified configuration version"
                      value={p.qualification.configuration_version}
                    />
                    <Identity
                      label="Qualified configuration hash"
                      value={p.qualification.configuration_hash}
                    />
                  </dl>
                  <p>
                    Bound secret revision fingerprints:{' '}
                    {Object.entries(p.qualification.secret_revision_hashes).map(([name, hash]) => (
                      <span key={name} className="block break-all font-mono text-xs">
                        {name}: {hash}
                      </span>
                    ))}
                  </p>
                  {p.qualification.checks.map((check) => (
                    <div key={check.name}>
                      <p>
                        {check.name}: {check.status}
                      </p>
                      {check.results.map((result, i) => (
                        <p key={i}>
                          {result.workload_slug} · {result.deployment_id}: {result.status}
                          {result.error_code ? ` · ${result.error_code}` : ''}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <p>
                  No qualification receipt returned.{' '}
                  {p.qualification_required
                    ? 'This preview requires qualification.'
                    : 'This preview does not require it; staging qualification for console controls remains separate.'}
                </p>
              )}
              <ul aria-label="Preview workload identities" className="space-y-3">
                {p.changes.map((change) => (
                  <li key={change.workload_slug} className="rounded-lg border border-border p-3">
                    <p className="break-all">
                      {change.workload_slug}: {change.kind}
                    </p>
                    <dl className="grid gap-3 sm:grid-cols-2">
                      <Identity label="Source revision" value={change.source_revision} />
                      <Identity label="Target revision" value={change.target_revision} />
                      <Identity label="Source deployment" value={change.source_deployment_id} />
                      <Identity label="Target deployment" value={change.target_deployment_id} />
                      <Identity
                        label="Source workload hash"
                        value={change.source_workload_config_hash}
                      />
                      <Identity
                        label="Target workload hash"
                        value={change.target_workload_config_hash}
                      />
                    </dl>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p role="alert">
              Preview evidence does not match this selection. Refresh before review.
            </p>
          )}
        </div>
      </Panel>
      <Panel
        title="Recorded promotion operations"
        description="Inspect existing operations without restarting or rolling them back."
      >
        <div className="space-y-4 p-4 text-sm">
          <label className="flex flex-col gap-1.5">
            Recorded status
            <select
              aria-label="Recorded status"
              className="rounded-md border border-border bg-background p-2"
              value={status ?? ''}
              onChange={(e) =>
                onSearch({
                  promotionStatus: (e.target.value || undefined) as PromotionFilters['status'],
                  promotionBefore: undefined,
                  promotion: undefined,
                })
              }
            >
              <option value="">All statuses</option>
              <option value="running">Running</option>
              <option value="succeeded">Succeeded</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          {history.error ? (
            <div role="alert">
              <p>Recorded operations could not be read; this is not an empty history.</p>
              <Button variant="outline" onClick={() => void history.refetch()}>
                Refresh history
              </Button>
            </div>
          ) : history.isPending || history.isFetching ? (
            <p role="status">Reading recorded operations…</p>
          ) : history.data ? (
            <>
              <ul aria-label="Recorded operations" className="space-y-2">
                {history.data.items.map((row) => (
                  <li key={row.promotion_id}>
                    <Button
                      variant="outline"
                      className="h-auto w-full justify-start whitespace-normal break-all py-2 text-left"
                      onClick={() => onSearch({ promotion: row.promotion_id })}
                    >
                      {row.promotion_id} · {row.from_environment} → {row.to_environment} ·{' '}
                      {row.status}
                    </Button>
                  </li>
                ))}
              </ul>
              {history.data.items.length === 0 && <p>No operations recorded on this page.</p>}
              <div className="flex flex-wrap gap-2">
                {before && (
                  <Button
                    variant="outline"
                    onClick={() => onSearch({ promotionBefore: undefined, promotion: undefined })}
                  >
                    Newest operations
                  </Button>
                )}
                {history.data.nextBefore && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      onSearch({ promotionBefore: history.data?.nextBefore, promotion: undefined })
                    }
                  >
                    Older operations
                  </Button>
                )}
                <Button variant="outline" onClick={() => void history.refetch()}>
                  Refresh history
                </Button>
              </div>
            </>
          ) : null}
          {operation && (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <p className="break-all">Selected operation: {operation}</p>
              <p>
                A timeout or disconnect is not permission to restart or roll back. Refresh the same
                durable operation identity. Accepted intent and workload application remain separate
                from verification.
              </p>
              <Button
                variant="outline"
                disabled={receipt.isFetching}
                onClick={() => void receipt.refetch()}
              >
                Refresh operation
              </Button>
              {r &&
                r.status !== 'running' &&
                r.rollback_status !== 'rolled_back' &&
                r.rollback_status !== 'rolling_back' && (
                  <Button
                    variant="outline"
                    disabled={rollback.isPending}
                    onClick={() => void onRollback(r.promotion_id, r.from_environment)}
                  >
                    Roll back this promotion
                  </Button>
                )}
              {receipt.error ? (
                <p role="alert">
                  This operation could not be read in the selected target. No recovery mutation was
                  submitted.
                </p>
              ) : receipt.isPending || receipt.isFetching ? (
                <p role="status">Reading operation checkpoints…</p>
              ) : r ? (
                <>
                  <p>
                    Recorded operation: {r.status} · Verification:{' '}
                    {r.verification_status ?? 'Unverified'} · Rollback:{' '}
                    {r.rollback_status ?? 'Not recorded'}
                  </p>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <Identity label="Operation hash" value={r.promotion_hash} />
                    <Identity label="Last recorded update" value={r.updated_at} />
                    <Identity
                      label="Activated target release set"
                      value={r.release_graph?.target_release_set_id}
                    />
                    <Identity
                      label="Restored release set"
                      value={r.release_graph?.restored_target_release_set_id}
                    />
                  </dl>
                  <p>
                    Recorded status does not prove complete resource coverage or current serving
                    health. Qualification and approval identities not returned by this status
                    endpoint are not inferred.
                  </p>
                  <ul aria-label="Operation checkpoints" className="space-y-2">
                    {r.workloads.map((row) => (
                      <li key={row.workload_slug} className="rounded-md border border-border p-3">
                        <p className="break-all">
                          {row.workload_slug} · Recorded application: {row.status}
                        </p>
                        <p>
                          Verification: {row.verification_status ?? 'Unverified'} · Rollback:{' '}
                          {row.rollback_status ?? 'Not recorded'}
                        </p>
                        <dl>
                          <Identity label="Target deployment" value={row.target_deployment_id} />
                          <Identity
                            label="Restored deployment"
                            value={row.restored_target_deployment_id}
                          />
                        </dl>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p role="alert">Operation evidence does not match this target.</p>
              )}
            </div>
          )}
        </div>
      </Panel>
      <Panel
        title="Inspect a known approval"
        description="Use the durable approval ID from an existing reviewed CLI/API operation. Do not enter a token."
      >
        <div className="space-y-3 p-4 text-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!validApprovalId(approvalDraft)) {
                setApprovalError('Enter a UUID approval ID, not an approval token.');
                return;
              }
              setApprovalError('');
              onSearch({ approval: canonicalApprovalId(approvalDraft) });
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              Approval ID
              <input
                aria-label="Approval ID"
                autoComplete="off"
                maxLength={36}
                value={approvalDraft}
                onChange={(e) => setApprovalDraft(e.target.value)}
                className="rounded-md border border-border bg-background p-2"
              />
            </label>
            <Button type="submit" variant="outline">
              Inspect approval
            </Button>
          </form>
          {approvalError && <p role="alert">{approvalError}</p>}
          {approval &&
            (approvalReceipt.error ? (
              <p role="alert">
                Approval could not be read for this target. No token is recovered or recreated.
              </p>
            ) : approvalReceipt.isPending || approvalReceipt.isFetching ? (
              <p role="status">Reading approval lifecycle…</p>
            ) : a ? (
              <div>
                <p>Approval state: {a.status}</p>
                <p className="break-all">
                  ID: {a.approval_id} · Type: {a.token_kind}
                </p>
                <p>
                  Returned expiry: {a.expires_at}
                  {a.consumed_at ? ` · Consumed: ${a.consumed_at}` : ''}
                </p>
                <Button variant="outline" onClick={() => void approvalReceipt.refetch()}>
                  Refresh approval
                </Button>
              </div>
            ) : (
              <p role="alert">Approval evidence does not match this target.</p>
            ))}
        </div>
      </Panel>
    </div>
  );
}
