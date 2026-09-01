import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, Page, Upload } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD, FieldError } from '@/components/ui/field';
import { PageHeader, Panel } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { Swap } from '@/components/dashboard/motion';
import { useToast } from '@/components/ui/toast';
import { useProjectApply, useProjectScan, type ProjectPlan } from '@/lib/api/queries';
import { AffectedApps } from '@/components/dashboard/affected-apps';
import { affectedRows, onlyCsv } from '@/lib/project-subset';
import { errorMessage } from '@/lib/api/errors';
import { consoleHead } from '@/lib/seo';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/dashboard/import')({
  component: ImportPage,
  head: () => consoleHead('import'),
});

/**
 * Repository import — `/v1/projects/scan` + `/v1/projects`.
 *
 * The migration path for someone arriving from Kubernetes, Compose, Render,
 * Fly, or serverless.yml: upload a repo tarball, the scanner reads the
 * manifests it finds and answers with a plan — the workloads it will create,
 * the managed services it will NOT provision (with the env hint to wire them
 * yourself), the crons it lifted — and applying creates everything in one
 * transaction. The scan is a dry run; nothing exists until Apply, and the
 * plan token means the server does not extract the tarball twice.
 */

const SOURCE_LABEL: Record<ProjectPlan['scan_source'], string> = {
  k8s: 'Kubernetes manifests',
  compose: 'Docker Compose',
  procfile: 'Procfile',
  render: 'render.yaml',
  fly: 'fly.toml',
  serverless: 'serverless.yml',
  workspace: 'Workspace config',
  convention: 'Convention scan',
  single: 'Single service',
  unknown: 'Unknown layout',
};

const SLUG_RULE = /^[a-z0-9][a-z0-9-]*$/;

function ImportPage() {
  const { toast } = useToast();
  const scan = useProjectScan();
  const apply = useProjectApply();

  const [file, setFile] = useState<File | null>(null);
  const [slug, setSlug] = useState('');
  const [branch, setBranch] = useState('main');
  const [slugTouched, setSlugTouched] = useState(false);
  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [applied, setApplied] = useState<{ slug: string; id: string }[] | null>(null);
  // The CLI's --exclude, staged: unticked workloads feed the next re-scan's
  // `only` CSV. `lastOnly` is whatever the current plan was scanned with, so
  // Apply always matches the previewed plan exactly.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [lastOnly, setLastOnly] = useState<string | undefined>(undefined);

  const slugOk = slug.trim() === '' || SLUG_RULE.test(slug.trim());
  const showSlugError = slugTouched && !slugOk;

  const runScan = (only?: string) => {
    if (!file || !slugOk || scan.isPending) return;
    setApplied(null);
    setLastOnly(only);
    void scan
      .mutateAsync({ file, slug, branch, only })
      .then((next) => {
        setPlan(next);
        setExcluded(new Set());
      })
      .catch((err: unknown) =>
        toast({ kind: 'error', title: 'Scan failed', description: errorMessage(err) })
      );
  };

  const runApply = () => {
    if (!file || !plan || apply.isPending) return;
    void apply
      .mutateAsync({ file, slug, branch, only: lastOnly, planToken: plan.plan_token })
      .then((result) => {
        setApplied(result.apps ?? []);
        toast({
          kind: 'success',
          title: 'Project applied',
          description: `${result.apps?.length ?? 0} app${(result.apps?.length ?? 0) === 1 ? '' : 's'} created; builds are enqueued.`,
        });
      })
      .catch((err: unknown) =>
        toast({ kind: 'error', title: 'Could not apply', description: errorMessage(err) })
      );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Import"
        description="Bring a repository from Kubernetes, Compose, Render, Fly, or serverless. Scan first — nothing is created until you apply the plan."
      />

      <Panel
        lit
        title="Scan a repository"
        description="A .tar.gz of the repo root. The scan is a dry run."
      >
        <div className="flex flex-wrap items-end gap-3">
          <label
            className={cn(
              'flex h-24 min-w-64 flex-1 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-sm transition-colors',
              file
                ? 'border-brand/50 text-foreground'
                : 'border-border text-muted-foreground hover:border-border-secondary'
            )}
          >
            <Upload className="h-4 w-4" />
            {file ? (
              <span className="font-mono text-xs">{file.name}</span>
            ) : (
              <span className="text-xs">Choose a .tar.gz</span>
            )}
            <input
              type="file"
              accept=".tar.gz,.tgz,application/gzip"
              className="sr-only"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPlan(null);
                setApplied(null);
              }}
            />
          </label>

          <label className="flex min-w-40 flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Project slug</span>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              onBlur={() => setSlugTouched(true)}
              aria-invalid={showSlugError || undefined}
              aria-describedby={showSlugError ? 'import-slug-error' : undefined}
              placeholder="repo name"
              className={cn(
                FIELD,
                'font-mono',
                showSlugError && 'border-[color:var(--status-critical)]'
              )}
            />
            {showSlugError && (
              <FieldError id="import-slug-error">
                Lowercase letters, digits, and dashes; defaults to the repo name.
              </FieldError>
            )}
          </label>

          <label className="flex min-w-32 flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Branch</span>
            <input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className={cn(FIELD, 'font-mono')}
            />
          </label>

          <Button
            size="sm"
            onClick={() => runScan()}
            disabled={!file || !slugOk}
            busy={scan.isPending}
          >
            <Page className="h-3.5 w-3.5" />
            Scan
          </Button>
        </div>
      </Panel>

      {plan && !applied && (
        <Swap id={plan.plan_token}>
          <div className="flex flex-col gap-6">
            <Panel
              title={`Plan — ${plan.project_slug}`}
              description={`Detected from ${SOURCE_LABEL[plan.scan_source]}.`}
              actions={
                <Button
                  size="sm"
                  onClick={runApply}
                  disabled={!plan.can_apply}
                  busy={apply.isPending}
                >
                  Apply plan
                </Button>
              }
              padded={false}
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      {[
                        'Include',
                        'Workload',
                        'Class',
                        'Root',
                        'Ports',
                        'Schedule',
                        'Detected from',
                      ].map((h) => (
                        <th
                          key={h}
                          scope="col"
                          className="label-mono px-4 py-2.5 text-muted-foreground"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {plan.workloads.map((w) => (
                      <tr key={w.name}>
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            aria-label={`Include ${w.name}`}
                            checked={!excluded.has(w.name)}
                            onChange={(e) => {
                              const next = new Set(excluded);
                              if (e.target.checked) next.delete(w.name);
                              else next.add(w.name);
                              setExcluded(next);
                            }}
                          />
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs">{w.name}</td>
                        <td className="px-4 py-2.5">
                          <Pill label={w.class ?? 'unknown'} color="var(--cat-compute)" />
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                          {w.root_dir || '/'}
                        </td>
                        <td className="px-4 py-2.5 text-xs [font-variant-numeric:tabular-nums]">
                          {w.ports.length ? w.ports.join(', ') : '—'}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs">{w.schedule ?? '—'}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {w.source ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {excluded.size > 0 && (
                <div className="flex items-center gap-3 border-t border-border px-4 py-3">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={excluded.size === plan.workloads.length}
                    busy={scan.isPending}
                    onClick={() =>
                      runScan(
                        onlyCsv(
                          plan.workloads.map((w) => w.name),
                          excluded
                        )
                      )
                    }
                  >
                    Re-scan with {excluded.size} excluded
                  </Button>
                  {excluded.size === plan.workloads.length && (
                    <span className="text-xs text-muted-foreground">
                      Keep at least one workload.
                    </span>
                  )}
                </div>
              )}
              <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
                {plan.observed_apps} of {plan.limit_apps} apps
                {plan.crons.length > 0 && (
                  <>
                    {' · '}
                    {plan.observed_crons} of {plan.limit_crons} crons
                    {plan.crons_not_allowed && (
                      <span style={{ color: 'var(--status-warning)' }}>
                        {' '}
                        — crons need a paid plan
                      </span>
                    )}
                  </>
                )}
                {!plan.can_apply && (
                  <span style={{ color: 'var(--status-critical)' }}>
                    {' '}
                    — over quota; the plan cannot be applied as-is
                  </span>
                )}
              </p>
            </Panel>

            {affectedRows(plan).length > 0 && (
              <Panel
                title="What this apply touches"
                description="Every existing app in the account, against what the plan would do to it."
              >
                <AffectedApps rows={affectedRows(plan)} />
                {(plan.can_apply_reasons?.length ?? 0) > 0 && (
                  <ul className="mt-3 flex flex-col gap-1">
                    {plan.can_apply_reasons?.map((r) => (
                      <li key={r} className="text-xs" style={{ color: 'var(--status-critical)' }}>
                        {r}
                      </li>
                    ))}
                  </ul>
                )}
                {plan.gate_rescued_by_exclude && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Excluding those workloads brought this under your plan's limits.
                  </p>
                )}
              </Panel>
            )}

            {(plan.managed.length > 0 || (plan.warnings?.length ?? 0) > 0) && (
              <Panel
                title="Not provisioned"
                description="Services the repo declares that the platform will not create — wire them via the env hints."
              >
                <ul className="flex flex-col gap-2">
                  {plan.managed.map((m) => (
                    <li
                      key={m.name}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                    >
                      <span className="font-mono text-xs">{m.name}</span>
                      <span className="text-xs text-muted-foreground">{m.kind}</span>
                      <span className="label-mono normal-case text-muted-foreground">
                        env: {m.env_hint}
                      </span>
                    </li>
                  ))}
                  {plan.warnings?.map((w) => (
                    <li key={w} className="text-xs" style={{ color: 'var(--status-warning)' }}>
                      {w}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        </Swap>
      )}

      {applied && (
        <Panel
          lit
          title="Applied"
          description="Builds are enqueued; each app goes live as its build lands."
        >
          <ul className="flex flex-col gap-1.5">
            {applied.map((a) => (
              <li key={a.id}>
                <Link
                  to="/dashboard/workflows/$workflowId"
                  params={{ workflowId: a.slug }}
                  className="pressable inline-flex items-center gap-1.5 rounded font-mono text-xs text-brand hover:text-brand-hover"
                >
                  {a.slug}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
