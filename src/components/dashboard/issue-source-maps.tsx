import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Circle, PauseSolid, Upload } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { FIELD } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  SOURCE_MAP_UPLOAD_BYTES,
  isNothingPublished,
  parseManifest,
  publishSourceMaps,
  retireSourceMaps,
  sourceMapsKey,
  useSourceMaps,
  type SourceMapManifest,
  type SourceMaps,
} from '@/lib/api/issue-trackers';
import { useIssueDeployments } from '@/lib/api/issues';
import { CliCommand } from './cli-command';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { ProblemHelp } from './problem-help';
import { StatusTag } from './postgres-shared';

/**
 * Deployment source maps for server-side symbolication (faas docs/issues.md
 * § Publish deployment artifacts for REST and OTLP symbolication). Pick a
 * deployment, read whether its maps are published, publish the manifest that
 * `gregale-issue-source-maps` generated, or retire a set. The manifest is
 * immutable per deployment, and the page shows what apid answered rather than
 * anything worked out locally.
 */

/** A source-map failure in words, branched on apid's codes (handlers_issues.go:102-145). */
export function explainSourceMapError(err: unknown): string {
  if (!(err instanceof ApiError)) return errorMessage(err);
  switch (err.code) {
    case 'issue_source_maps_conflict':
      return 'A different manifest is already recorded for this deployment, and it cannot be replaced, even after retiring. Publish the identical manifest, or deploy again.';
    case 'issue_quota_exceeded':
      return 'This app already keeps 32 ready source-map sets. Retire an obsolete one first.';
    case 'validation_failed':
      return err.detail ?? err.message;
    default:
      return errorMessage(err);
  }
}

export function IssueSourceMaps({ accountId, slug }: { accountId: string; slug: string }) {
  const deployments = useIssueDeployments(accountId, slug);
  const rows = deployments.data?.pages.flatMap((p) => p.items) ?? [];
  const [chosen, setChosen] = useState('');
  const deploymentId = rows.some((r) => r.id === chosen) ? chosen : (rows[0]?.id ?? '');
  const phase = queryPhase({
    error: deployments.error,
    loading: deployments.isPending,
    isEmpty: rows.length === 0,
  });
  return (
    <section aria-label="Source maps" className="flex min-w-0 flex-col gap-5">
      <div>
        <h3 className="text-base font-semibold">Source maps</h3>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Publish a deployment’s Node source maps so apid maps reported frames to original files and
          symbols. Reporters opt in with the{' '}
          <code className="font-mono text-xs">deployment-source-maps-v1</code> symbolication
          strategy; until a deployment’s maps are published, its opted-in captures are refused with{' '}
          <code className="font-mono text-xs">issue_source_maps_unavailable</code>. Map contents
          stay private: apid returns readiness and a digest, never the maps.
        </p>
      </div>
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={deployments.error}
          loadingMessage="Reading deployments…"
          emptyMessage={`${slug} has no deployments yet.`}
          onRetry={() => void deployments.refetch()}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-0 max-w-full flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">Deployment</span>
              <select
                className={`${FIELD} max-w-full font-mono`}
                value={deploymentId}
                onChange={(e) => setChosen(e.target.value)}
              >
                {rows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id.slice(0, 8)} · {r.status} · {new Date(r.created_at).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
            {deployments.hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                disabled={deployments.isFetchingNextPage}
                onClick={() => void deployments.fetchNextPage()}
              >
                Older deployments
              </Button>
            )}
          </div>
          <DeploymentSourceMaps
            key={deploymentId}
            accountId={accountId}
            slug={slug}
            deploymentId={deploymentId}
          />
        </>
      )}
    </section>
  );
}

function DeploymentSourceMaps({
  accountId,
  slug,
  deploymentId,
}: {
  accountId: string;
  slug: string;
  deploymentId: string;
}) {
  const query = useSourceMaps(accountId, slug, deploymentId);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const nothing = isNothingPublished(query.error);
  const phase = queryPhase({ error: nothing ? undefined : query.error, loading: query.isPending });
  const meta = query.data;
  const show = (answer: SourceMaps) =>
    qc.setQueryData(sourceMapsKey(accountId, slug, deploymentId), answer);

  const retire = async () => {
    if (
      !(await confirm({
        title: 'Retire these source maps?',
        description:
          'The maps are deleted and the slot is freed. The manifest digest stays recorded, so only this exact manifest can be published for the deployment again. New opted-in captures from it are refused until then.',
        confirmLabel: 'Retire maps',
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    try {
      show(await retireSourceMaps(slug, deploymentId));
      toast({ kind: 'success', title: 'Source maps retired' });
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Could not retire',
        description: explainSourceMapError(err),
        error: err,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Publication" actions={<CopyableId value={deploymentId} label="deployment ID" />}>
      <div className="flex flex-col gap-4">
        {phase !== 'ready' ? (
          <InlinePhase
            phase={phase}
            error={query.error}
            loadingMessage="Reading source maps…"
            onRetry={() => void query.refetch()}
          />
        ) : nothing || !meta ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Circle aria-hidden className="h-3.5 w-3.5" />
            Nothing published for this deployment.
          </p>
        ) : (
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1">
              <dt className="label-mono text-muted-foreground">State</dt>
              <dd>
                {meta.retired_at ? (
                  <StatusTag tone="muted" icon={PauseSolid}>
                    Retired
                  </StatusTag>
                ) : meta.ready ? (
                  <StatusTag tone="good" icon={CheckCircle}>
                    Ready
                  </StatusTag>
                ) : (
                  <StatusTag tone="warning" icon={Circle}>
                    Not ready
                  </StatusTag>
                )}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="label-mono text-muted-foreground">Maps</dt>
              <dd className="font-mono">{meta.map_count}</dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="label-mono text-muted-foreground">Manifest SHA-256</dt>
              <dd className="min-w-0">
                <CopyableId value={meta.manifest_sha256} label="manifest digest" />
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="label-mono text-muted-foreground">
                {meta.retired_at ? 'Retired' : 'Published'}
              </dt>
              <dd>
                <Timestamp value={meta.retired_at ?? meta.created_at} />
              </dd>
            </div>
          </dl>
        )}
        {meta && !meta.retired_at && (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={busy}
            onClick={() => void retire()}
          >
            Retire maps
          </Button>
        )}
        {(nothing || meta?.retired_at) && (
          <PublishForm
            slug={slug}
            deploymentId={deploymentId}
            restoring={Boolean(meta?.retired_at)}
            onPublished={show}
          />
        )}
      </div>
    </Panel>
  );
}

function PublishForm({
  slug,
  deploymentId,
  restoring,
  onPublished,
}: {
  slug: string;
  deploymentId: string;
  restoring: boolean;
  onPublished: (answer: SourceMaps) => void;
}) {
  const { toast } = useToast();
  const [directory, setDirectory] = useState('/app/dist');
  const [manifest, setManifest] = useState<{ name: string; value: SourceMapManifest }>();
  const [problem, setProblem] = useState<string>();
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const absolute = directory.startsWith('/') && directory.length <= 512;

  const choose = async (file: File | undefined) => {
    setManifest(undefined);
    setProblem(undefined);
    if (!file) return;
    if (file.size > SOURCE_MAP_UPLOAD_BYTES) {
      setProblem('The manifest is larger than the 4 MiB upload limit.');
      return;
    }
    const parsed = parseManifest(await file.text());
    if (typeof parsed === 'string') setProblem(parsed);
    else setManifest({ name: file.name, value: parsed });
  };

  const publish = async () => {
    if (!manifest || !absolute || busy) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const answer = await publishSourceMaps(slug, deploymentId, {
        directory,
        manifest: manifest.value,
      });
      onPublished(answer);
      toast({
        kind: 'success',
        title: answer.ready ? `Published ${answer.map_count} maps` : 'Published; not ready yet',
      });
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <h4 className="text-sm font-medium">{restoring ? 'Restore the same manifest' : 'Publish'}</h4>
      <p className="text-xs text-muted-foreground">
        Generate the manifest after your build with{' '}
        <code className="font-mono">
          npx gregale-issue-source-maps dist dist/.gregale-issue-maps.json
        </code>
        , then choose it here with the absolute directory it describes in the deployed app. Embedded
        source contents are discarded; bundle digests are your build’s claim and are not re-checked
        by apid.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Deployed directory</span>
          <input
            value={directory}
            onChange={(e) => setDirectory(e.target.value)}
            className={`${FIELD} font-mono`}
            aria-invalid={absolute ? undefined : true}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Manifest file</span>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => void choose(e.target.files?.[0])}
            className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground"
          />
        </label>
      </div>
      {!absolute && (
        <p className="text-xs" style={{ color: 'var(--status-critical)' }}>
          Use the absolute directory, such as /app/dist.
        </p>
      )}
      {problem && (
        <p role="alert" className="text-xs" style={{ color: 'var(--status-critical)' }}>
          {problem}
        </p>
      )}
      {manifest && (
        <p className="text-xs text-muted-foreground">
          {manifest.name}: {manifest.value.artifacts.length}{' '}
          {manifest.value.artifacts.length === 1 ? 'map' : 'maps'} for{' '}
          {manifest.value.artifacts
            .map((a) => a.generatedFile)
            .slice(0, 3)
            .join(', ')}
          {manifest.value.artifacts.length > 3 ? ', …' : ''}
        </p>
      )}
      {failure !== undefined && (
        <div role="alert" className="flex flex-col gap-1 text-sm">
          <span style={{ color: 'var(--status-critical)' }}>{explainSourceMapError(failure)}</span>
          <ProblemHelp error={failure} />
        </div>
      )}
      <Button
        className="self-start"
        disabled={!manifest || !absolute || busy}
        onClick={() => void publish()}
      >
        <Upload aria-hidden className="h-3.5 w-3.5" />
        {busy ? 'Publishing…' : 'Publish source maps'}
      </Button>
      <CliCommand
        label="Or from CI, with an owner API key:"
        command={`gregale debug issue source-map publish --app ${slug} --deployment ${deploymentId} --directory ${directory || '/app/dist'} --manifest-file dist/.gregale-issue-maps.json`}
        copyLabel={`source-map publish command for ${slug}`}
      />
    </div>
  );
}
