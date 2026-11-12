import { useState } from 'react';
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
import { Panel } from '../primitives';
import { Select } from '@/components/ui/field';

export type ReadinessSearch = {
  promotion?: string;
  approval?: string;
  promotionBefore?: string;
  promotionStatus?: PromotionFilters['status'];
};
export const validApprovalId = (value: string) => Boolean(canonicalApprovalId(value));
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
  return (
    <div className="space-y-5">
      <Panel title="Environment readiness">
        <div className="space-y-4 p-4 text-sm">
          <p>
            Promote, rollback, full clone and GitOps enforcement are not available in the console.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled>Promote</Button>
            <Button disabled variant="outline">
              Rollback
            </Button>
            <Button disabled variant="outline">
              Create full clone
            </Button>
            <Button disabled variant="outline">
              Enforce GitOps
            </Button>
          </div>
          {!source ? (
            <p>Select Compare to inspect a source-to-target preview.</p>
          ) : preview.error ? (
            <div role="alert">
              <p>
                The promotion preview could not be read. Permissions, MFA or a changed selection may
                need attention.
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
                A changed source or target needs a fresh preview.
              </p>
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
                Secrets and managed credentials stay with the target; shared resources are not
                copied.
              </p>
              {p.qualification ? (
                <div className="space-y-2 well rounded-xl bg-muted/40 p-3">
                  <p>
                    Qualification: {p.qualification.id} · {p.qualification.status}
                  </p>
                  <p>
                    Returned expiry: <code>{p.qualification.expires_at}</code>
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
                    : 'This preview does not require it.'}
                </p>
              )}
              <ul aria-label="Preview workload identities" className="space-y-3">
                {p.changes.map((change) => (
                  <li key={change.workload_slug} className="well rounded-xl bg-muted/40 p-3">
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
            <p role="alert">Preview details do not match this selection. Refresh before review.</p>
          )}
        </div>
      </Panel>
      <Panel title="Recorded promotion operations">
        <div className="space-y-4 p-4 text-sm">
          <label className="flex flex-col gap-1.5">
            Recorded status
            <Select
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
            </Select>
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
            <div className="space-y-3 well rounded-xl bg-muted/40 p-3">
              <p className="break-all">Selected operation: {operation}</p>
              <p>
                A timeout or disconnect is not permission to restart or roll back; refresh this
                operation instead.
              </p>
              <Button
                variant="outline"
                disabled={receipt.isFetching}
                onClick={() => void receipt.refetch()}
              >
                Refresh operation
              </Button>
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
                  <ul aria-label="Operation checkpoints" className="space-y-2">
                    {r.workloads.map((row) => (
                      <li key={row.workload_slug} className="well rounded-xl bg-muted/40 p-3">
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
                <p role="alert">Operation details do not match this target.</p>
              )}
            </div>
          )}
        </div>
      </Panel>
      <Panel
        title="Inspect a known approval"
        help="Enter the approval ID from a CLI or API operation, never a token."
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
              <p role="alert">Approval details do not match this target.</p>
            ))}
        </div>
      </Panel>
    </div>
  );
}
