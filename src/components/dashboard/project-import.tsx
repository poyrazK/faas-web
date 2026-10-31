import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Check, NavArrowRight, Page, Upload } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD, FieldError } from '@/components/ui/field';
import { Pill } from '@/components/dashboard/resource-table';
import { Swap } from '@/components/dashboard/motion';
import { useToast } from '@/components/ui/toast';
import { useProjectApply, useProjectScan, type ProjectPlan } from '@/lib/api/queries';
import { cn } from '@/lib/utils';
import { useUnsavedGuard } from '@/lib/use-unsaved-guard';
import { SCAN_SOURCE_LABEL } from './scan-source';
import { SettingRow, SettingsSection } from './new-app-settings';

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

const SLUG_RULE = /^[a-z0-9][a-z0-9-]*$/;

export function ProjectImport({
  initialSlug = '',
  initialBranch = 'main',
}: {
  initialSlug?: string;
  initialBranch?: string;
}) {
  const { toast } = useToast();
  const scan = useProjectScan();
  const apply = useProjectApply();

  const [file, setFile] = useState<File | null>(null);
  const [slug, setSlug] = useState(initialSlug);
  const [branch, setBranch] = useState(initialBranch);
  const [slugTouched, setSlugTouched] = useState(false);
  const [scanResult, setScanResult] = useState<{
    plan: ProjectPlan;
    file: File;
    slug: string;
    branch: string;
  } | null>(null);
  const [applied, setApplied] = useState<{
    apps: { slug: string; id: string }[];
    projectSlug?: string;
  } | null>(null);
  // A token is applicable only to the inputs that produced it, including
  // when an earlier scan resolves after the user has edited those inputs.
  const plan =
    scanResult &&
    scanResult.file === file &&
    scanResult.slug === slug &&
    scanResult.branch === branch
      ? scanResult.plan
      : null;
  useUnsavedGuard(Boolean(file) && !applied, undefined, '/dashboard/apps/new');

  const slugOk = slug.trim() === '' || SLUG_RULE.test(slug.trim());
  const showSlugError = slugTouched && !slugOk;

  const runScan = () => {
    if (!file || !slugOk || scan.isPending) return;
    setApplied(null);
    void scan
      .mutateAsync({ file, slug, branch })
      .then((plan) => setScanResult({ plan, file, slug, branch }))
      .catch((err: unknown) => toast({ kind: 'error', title: 'Scan failed', error: err }));
  };

  const runApply = () => {
    if (!file || !plan || apply.isPending) return;
    void apply
      .mutateAsync({ file, slug, branch, planToken: plan.plan_token })
      .then((result) => {
        setApplied({
          apps: result.apps ?? [],
          projectSlug: result.project_id ? plan.project_slug : undefined,
        });
        toast({
          kind: 'success',
          title: 'Project applied',
          description: `${result.apps?.length ?? 0} app${(result.apps?.length ?? 0) === 1 ? '' : 's'} created; builds are enqueued.`,
        });
      })
      .catch((err: unknown) => toast({ kind: 'error', title: 'Could not apply', error: err }));
  };

  const plain = (label: string, value: string) => (
    <span>
      <span className="sr-only">{label} </span>
      {value}
    </span>
  );

  return (
    <div className="flex flex-col gap-8">
      <SettingsSection id="import-project" title="Project">
        <SettingRow label="Archive" hint="A .tar.gz of the repo root. The scan is a dry run.">
          <label
            className={cn(
              'flex h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-sm transition-colors has-focus-visible:ring-2 has-focus-visible:ring-brand',
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
                setScanResult(null);
                setApplied(null);
              }}
            />
          </label>
        </SettingRow>
        <SettingRow
          label="Project slug"
          htmlFor="import-slug"
          hint="Lowercase letters, digits, and dashes; defaults to the repo name."
        >
          <input
            id="import-slug"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value.toLowerCase());
              setApplied(null);
            }}
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
        </SettingRow>
        <SettingRow label="Branch" htmlFor="import-branch">
          <input
            id="import-branch"
            value={branch}
            onChange={(e) => {
              setBranch(e.target.value);
              setApplied(null);
            }}
            className={cn(FIELD, 'font-mono')}
          />
        </SettingRow>
      </SettingsSection>

      {!plan && !applied && (
        <div className="flex justify-end">
          <Button
            variant="cta"
            onClick={runScan}
            disabled={!file || !slugOk}
            busy={scan.isPending}
            className="h-10 gap-2 rounded-lg"
          >
            <Page className="h-4 w-4" />
            Scan
          </Button>
        </div>
      )}

      {plan && !applied && (
        <Swap id={plan.plan_token}>
          <div className="flex flex-col gap-8">
            <section aria-labelledby="import-plan" className="flex flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <h2 id="import-plan" className="text-sm font-medium text-muted-foreground">
                  Plan — {plan.project_slug}
                </h2>
                <p className="text-[13px] text-muted-foreground">
                  Detected from {SCAN_SOURCE_LABEL[plan.scan_source]}.
                </p>
              </div>
              <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
                {(plan.workloads ?? []).map((w) => (
                  <li key={w.name} className="flex flex-col gap-1 px-4 py-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-mono text-sm font-medium">{w.name}</span>
                      <Pill label={w.class ?? 'unknown'} color="var(--cat-compute)" />
                    </span>
                    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-muted-foreground [font-variant-numeric:tabular-nums]">
                      {plain('Root', w.root_dir || '/')}
                      {w.ports?.length ? plain('Ports', `:${w.ports.join(', :')}`) : null}
                      {w.schedule ? plain('Schedule', w.schedule) : null}
                      {w.source ? plain('Detected from', w.source) : null}
                    </span>
                  </li>
                ))}
                <li className="px-4 py-3 text-[13px] text-muted-foreground">
                  {plan.observed_apps} of {plan.limit_apps} apps
                  {(plan.crons?.length ?? 0) > 0 && (
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
                </li>
              </ul>
            </section>

            {((plan.managed?.length ?? 0) > 0 || (plan.warnings?.length ?? 0) > 0) && (
              <section aria-labelledby="import-unprovisioned" className="flex flex-col gap-3">
                <div className="flex flex-col gap-0.5">
                  <h2
                    id="import-unprovisioned"
                    className="text-sm font-medium text-muted-foreground"
                  >
                    Not provisioned
                  </h2>
                  <p className="text-[13px] text-muted-foreground">
                    Services the repo declares that the platform will not create. Wire them in with
                    the env hints.
                  </p>
                </div>
                <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
                  {plan.managed?.map((m) => (
                    <li key={m.name} className="flex flex-col gap-0.5 px-4 py-3">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium">{m.name}</span>
                        <span className="text-[13px] text-muted-foreground">{m.kind}</span>
                      </span>
                      <span className="font-mono text-[13px] text-muted-foreground">
                        env: {m.env_hint}
                      </span>
                    </li>
                  ))}
                  {plan.warnings?.map((w) => (
                    <li
                      key={w}
                      className="px-4 py-3 text-[13px]"
                      style={{ color: 'var(--status-warning)' }}
                    >
                      {w}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="flex flex-wrap justify-end gap-3">
              <Button
                variant="outline"
                onClick={runScan}
                disabled={!file || !slugOk}
                busy={scan.isPending}
              >
                Scan again
              </Button>
              <Button
                variant="cta"
                onClick={runApply}
                disabled={!plan.can_apply}
                busy={apply.isPending}
                className="h-10 rounded-lg"
              >
                Apply plan
              </Button>
            </div>
          </div>
        </Swap>
      )}

      {applied && (
        <section aria-labelledby="import-applied" className="flex flex-col gap-3">
          <h2 id="import-applied" className="text-sm font-medium text-muted-foreground">
            Applied
          </h2>
          <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
            <div className="flex items-start gap-3.5 px-4 py-4">
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand/15 text-brand"
              >
                <Check className="h-[18px] w-[18px]" />
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-base font-medium">Builds are enqueued</p>
                <p className="text-[13px] leading-5 text-muted-foreground">
                  Each app goes live as its build lands.
                </p>
                {applied.projectSlug && (
                  <Link
                    to="/dashboard/projects/$projectSlug"
                    params={{ projectSlug: applied.projectSlug }}
                    className="mt-1 w-fit text-[13px] text-brand hover:underline"
                  >
                    View project {applied.projectSlug}
                  </Link>
                )}
              </div>
            </div>
            {applied.apps.map((a) => (
              <Link
                key={a.id}
                to="/dashboard/apps/$appSlug"
                params={{ appSlug: a.slug }}
                className="group flex items-center justify-between gap-3 px-4 py-3 font-mono text-sm transition-colors last:rounded-b-[11px] hover:bg-accent/40"
              >
                {a.slug}
                <NavArrowRight
                  aria-hidden
                  className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
                />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
