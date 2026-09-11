import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  useBuildProvenance,
  useFetchBuildSbom,
  useDeploymentScan,
  useDeploymentSecretScan,
} from '@/lib/api/queries';
import { InlinePhase, queryPhase } from './primitives';
import { Pill } from './resource-table';
import { RELEASE_SEVERITY_COLOR } from './release-status';

export function ReleaseProvenance({ buildId, succeeded }: { buildId: string; succeeded: boolean }) {
  const provenance = useBuildProvenance(buildId);
  const sbom = useFetchBuildSbom();
  const { toast } = useToast();
  const missing = provenance.error instanceof ApiError && provenance.error.status === 404;
  const download = async () => {
    try {
      const data = await sbom.mutateAsync(buildId);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      );
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `sbom-${buildId.slice(0, 12)}.cdx.json`;
        anchor.click();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      toast({ kind: 'error', title: 'No SBOM for this build', description: errorMessage(error) });
    }
  };
  return (
    <div className="flex flex-col gap-4">
      {!buildId ? (
        <p className="text-sm text-muted-foreground">No build is recorded for this release.</p>
      ) : (
        <>
          {missing ? (
            <p className="text-sm text-muted-foreground">
              No provenance was recorded for this build.
            </p>
          ) : provenance.data ? (
            <dl className="grid gap-3 sm:grid-cols-2">
              {[
                ['Commit', provenance.data.commit_sha],
                ['Source sha256', provenance.data.source_sha256],
                ['BuildKit', provenance.data.buildkit_version],
                ['Railpack', provenance.data.railpack_version],
                ['Base image', provenance.data.base_digest],
                ['Builder node', provenance.data.builder_node_id],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="label-mono text-muted-foreground">{label}</dt>
                    <dd className="break-all font-mono text-xs">{value}</dd>
                  </div>
                ))}
            </dl>
          ) : (
            <InlinePhase
              phase={queryPhase({
                error: provenance.error,
                loading: provenance.isPending,
                isEmpty: !provenance.data,
              })}
              error={provenance.error}
              emptyMessage="No provenance was recorded for this build."
            />
          )}
          {succeeded && (
            <Button
              size="sm"
              variant="outline"
              busy={sbom.isPending}
              onClick={() => void download()}
            >
              Download SBOM
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export function ReleaseScans({ deploymentId }: { deploymentId: string }) {
  const scan = useDeploymentScan(deploymentId);
  const secrets = useDeploymentSecretScan(deploymentId);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="label-mono mb-2 text-muted-foreground">Vulnerability scan</p>
        {!scan.data ? (
          <InlinePhase
            phase={queryPhase({ error: scan.error, loading: scan.isPending, isEmpty: true })}
            error={scan.error}
            emptyMessage="No scan has been recorded."
          />
        ) : scan.data.status !== 'complete' ? (
          <p className="text-sm text-muted-foreground">
            Scan {scan.data.status}
            {scan.data.error ? ` — ${scan.data.error}` : '.'}
          </p>
        ) : scan.data.vulnerabilities.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing known in this image.</p>
        ) : (
          <ul className="divide-y divide-border">
            {scan.data.vulnerabilities.map((v) => (
              <li
                key={`${v.id}-${v.package}-${v.version}`}
                className="flex flex-wrap gap-3 py-2 text-xs"
              >
                <Pill
                  label={v.severity.toLowerCase()}
                  color={RELEASE_SEVERITY_COLOR[v.severity.toUpperCase()]}
                />
                <span>{v.id}</span>
                <span>
                  {v.package}@{v.version}
                  {v.fixed_in ? ` → ${v.fixed_in}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="label-mono mb-2 text-muted-foreground">Secret scan</p>
        {!secrets.data ? (
          <InlinePhase
            phase={queryPhase({ error: secrets.error, loading: secrets.isPending, isEmpty: true })}
            error={secrets.error}
            emptyMessage="No secret scan recorded."
          />
        ) : secrets.data.error ||
          !['complete', 'complete_with_redactions'].includes(secrets.data.status) ? (
          <p className="text-sm text-muted-foreground">
            Secret scan {secrets.data.status}
            {secrets.data.error ? ` — ${secrets.data.error}` : '.'}
          </p>
        ) : !secrets.data.findings?.length ? (
          <p className="text-sm text-muted-foreground">No secrets found in the image layers.</p>
        ) : (
          <ul className="divide-y divide-border">
            {secrets.data.findings.map((f, i) => (
              <li key={`${f.file}-${f.line}-${i}`} className="flex flex-wrap gap-3 py-2 text-xs">
                <Pill label={f.severity} color="var(--status-critical)" />
                <span>{f.provider}</span>
                <span>
                  {f.file}:{f.line}
                </span>
                <span>{f.key}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
