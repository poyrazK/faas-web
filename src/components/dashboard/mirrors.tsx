import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { errorMessage } from '@/lib/api/errors';
import {
  useCreateMirror,
  useDeleteMirror,
  useMirrorSummary,
  useMirrors,
  useUpdateMirror,
} from '@/lib/api/queries';
import { MIRROR_DEFAULTS, mirrorSummaryRows, type MirrorRule } from '@/lib/mirrors';
import type { components } from '@/lib/api/schema';

type CreateBody = components['schemas']['CreateMirrorRuleRequest'];

const FIELD =
  'h-9 w-full rounded-md border border-border bg-background px-2 font-mono text-sm outline-none focus:border-brand/50';

export function MirrorForm({
  deployments,
  busy,
  onSubmit,
}: {
  deployments: { id: string; label: string }[];
  busy: boolean;
  onSubmit: (body: CreateBody) => void;
}) {
  const [source, setSource] = useState('');
  const [mirror, setMirror] = useState('');
  const [percent, setPercent] = useState<number>(MIRROR_DEFAULTS.percent);
  const [includeBody, setIncludeBody] = useState<boolean>(MIRROR_DEFAULTS.include_body);
  const [redact, setRedact] = useState(MIRROR_DEFAULTS.redact_headers.join(', '));
  const valid =
    source !== '' && mirror !== '' && source !== mirror && percent >= 1 && percent <= 100;
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSubmit({
          source_deployment_id: source,
          mirror_deployment_id: mirror,
          percent,
          include_body: includeBody,
          redact_headers: redact
            .split(',')
            .map((h) => h.trim().toLowerCase())
            .filter(Boolean),
        });
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Source deployment</span>
        <select
          aria-label="Source deployment"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className={FIELD}
        >
          <option value="">Choose…</option>
          {deployments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Mirror deployment</span>
        <select
          aria-label="Mirror deployment"
          value={mirror}
          onChange={(e) => setMirror(e.target.value)}
          className={FIELD}
        >
          <option value="">Choose…</option>
          {deployments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Percent of traffic</span>
        <input
          aria-label="Percent of traffic"
          type="number"
          min={1}
          max={100}
          value={percent}
          onChange={(e) => setPercent(Number(e.target.value))}
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Redact headers</span>
        <input
          aria-label="Redact headers"
          value={redact}
          onChange={(e) => setRedact(e.target.value)}
          className={FIELD}
        />
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          checked={includeBody}
          onChange={(e) => setIncludeBody(e.target.checked)}
        />
        Mirror request bodies too
      </label>
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={!valid} busy={busy}>
          Create mirror
        </Button>
      </div>
    </form>
  );
}

function SummaryModal({
  slug,
  rule,
  onClose,
}: {
  slug: string;
  rule: MirrorRule | null;
  onClose: () => void;
}) {
  const q = useMirrorSummary(slug, rule?.id ?? '', rule !== null);
  const phase = queryPhase({ error: q.error, loading: q.isPending, isEmpty: !q.data });
  return (
    <Modal
      open={rule !== null}
      onClose={onClose}
      title="Mirror drift"
      description="How the mirror deployment answered compared with the source."
      width="max-w-md"
    >
      {phase !== 'ready' || !q.data ? (
        <InlinePhase
          phase={phase}
          error={q.error}
          loadingMessage="Aggregating…"
          emptyMessage="No mirrored requests yet."
        />
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
          {mirrorSummaryRows(q.data).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="label-mono text-muted-foreground">{k}</dt>
              <dd className="font-mono text-sm">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </Modal>
  );
}

/**
 * Shadow a candidate with live traffic and measure the drift before it takes
 * a single real request. The CLI had `mirrors create/list/patch/rm/summary`;
 * the console had nothing.
 */
export function MirrorsPanel({
  slug,
  deployments,
}: {
  slug: string;
  deployments: { id: string; label: string }[];
}) {
  const list = useMirrors(slug);
  const create = useCreateMirror(slug);
  const update = useUpdateMirror(slug);
  const remove = useDeleteMirror(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [summaryFor, setSummaryFor] = useState<MirrorRule | null>(null);
  const [creating, setCreating] = useState(false);
  const rules = list.data?.rules ?? [];
  const phase = queryPhase({
    error: list.error,
    loading: list.isPending,
    isEmpty: rules.length === 0,
  });

  return (
    <Panel
      title="Traffic mirrors"
      description="Copy a share of one deployment's requests to another and compare the answers."
      actions={
        <Button size="sm" variant="outline" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Close' : 'New mirror'}
        </Button>
      }
    >
      {creating && (
        <div className="mb-4">
          <MirrorForm
            deployments={deployments}
            busy={create.isPending}
            onSubmit={(body) =>
              void create
                .mutateAsync(body)
                .then(() => {
                  setCreating(false);
                  toast({ kind: 'success', title: 'Mirror created' });
                })
                .catch((err: unknown) =>
                  toast({
                    kind: 'error',
                    title: 'Could not create mirror',
                    description: errorMessage(err),
                  })
                )
            }
          />
        </div>
      )}
      {phase !== 'ready' ? (
        <InlinePhase phase={phase} error={list.error} emptyMessage="No mirrors on this app." />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="font-mono text-xs">
                {r.source_deployment_id.slice(0, 8)} → {r.mirror_deployment_id.slice(0, 8)}
              </span>
              <span className="font-mono text-xs">{r.percent}%</span>
              <Pill
                label={r.enabled ? 'enabled' : 'paused'}
                color={r.enabled ? 'var(--status-good)' : undefined}
              />
              {r.include_body && <Pill label="bodies" color="var(--status-warning)" />}
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setSummaryFor(r)}>
                  Drift
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  busy={update.isPending}
                  onClick={() =>
                    void update
                      .mutateAsync({ id: r.id, enabled: !r.enabled })
                      .catch((err: unknown) =>
                        toast({
                          kind: 'error',
                          title: 'Could not update mirror',
                          description: errorMessage(err),
                        })
                      )
                  }
                >
                  {r.enabled ? 'Pause' : 'Resume'}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() =>
                    void confirm({
                      title: 'Delete this mirror?',
                      description:
                        'Mirrored traffic stops immediately. The mirror deployment keeps running.',
                      confirmLabel: 'Delete',
                      destructive: true,
                    }).then((ok) => {
                      if (!ok) return;
                      void remove.mutateAsync(r.id).catch((err: unknown) =>
                        toast({
                          kind: 'error',
                          title: 'Could not delete mirror',
                          description: errorMessage(err),
                        })
                      );
                    })
                  }
                >
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <SummaryModal slug={slug} rule={summaryFor} onClose={() => setSummaryFor(null)} />
    </Panel>
  );
}
