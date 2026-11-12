import { Button } from '@/components/ui/button';
import { FieldError, Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useCapability } from '@/lib/api/capabilities';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  PREVIEW_SLUG_MAX,
  PREVIEW_TTL_DEFAULT_HOURS,
  PREVIEW_TTL_MAX_HOURS,
  parsePreviewSlug,
  previewSlugFor,
  useCreatePreview,
  usePreview,
  validPreviewTtl,
  type PreviewAppResponse,
} from '@/lib/api/pr-previews';
import { useApp, useApps } from '@/lib/api/queries';
import { useOrgApps, useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { publicAppUrl } from '@/lib/app-url';
import { useAuth } from '@/lib/auth';
import { Link } from '@tanstack/react-router';
import { Plus } from 'iconoir-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { CapabilityNotice } from './capability-notice';
import { TearDownPreviewButton } from './preview-actions';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { ProblemHelp } from './problem-help';
import { ReleaseStatusLabel } from './release-status-label';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** A lease in the words the form uses: whole days when it is whole days. */
function leaseLabel(hours: number) {
  return hours % 24 === 0 ? plural(hours / 24, 'day') : plural(hours, 'hour');
}

/** Future-facing twin of `formatRelative`, which only counts backwards. */
function expiresIn(iso: string | null | undefined) {
  const ts = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ts)) return 'not set';
  const diff = ts - Date.now();
  if (diff <= 0) return 'expired';
  if (diff < HOUR) return `in ${plural(Math.max(1, Math.round(diff / 60_000)), 'minute')}`;
  const hours = Math.round(diff / HOUR);
  return hours < 24 ? `in ${plural(hours, 'hour')}` : `in ${plural(Math.round(diff / DAY), 'day')}`;
}

function Expiry({ iso }: { iso: string | null | undefined }) {
  return iso ? (
    <time dateTime={iso} title={iso}>
      {expiresIn(iso)}
    </time>
  ) : (
    <span className="text-muted-foreground">not set</span>
  );
}

/** A listed preview, from whichever inventory the workspace reads. */
interface PreviewRow {
  id: string;
  slug: string;
  parent: string;
  /** 0 is a developer preview. */
  prNumber: number;
  /** PR state and expiry: absent from a company's inventory. */
  state?: string;
  expiresAt?: string | null;
}
interface ParentApp {
  id: string;
  slug: string;
}

/**
 * The workspace's previews and production apps. `/v1/apps` is the signed-in
 * account's own list, so a company reads its inventory instead
 * (`/v1/orgs/{slug}/apps`), where a preview carries its parent's organization
 * (faas handlers_preview_create.go:211). That inventory has no preview
 * fields, so a preview is known there by its reserved `pr-{N}-{parent}` slug.
 * Nothing is read until the workspace is known.
 */
function useWorkspacePreviews() {
  const workspace = useWorkspaceTarget();
  const { org, ready } = workspace;
  const personal = useApps({ enabled: ready && !org });
  const company = useOrgApps(ready ? org : null);
  const query = org ? company : personal;
  let previews: PreviewRow[] = [];
  let parents: ParentApp[] = [];
  if (org) {
    for (const app of company.data?.apps ?? []) {
      const preview = parsePreviewSlug(app.slug);
      if (preview) previews.push({ id: app.id, slug: app.slug, ...preview });
      else parents.push(app);
    }
  } else {
    const apps = personal.data ?? [];
    previews = apps.flatMap((app) =>
      app.preview_of_slug
        ? [
            {
              id: app.id,
              slug: app.slug,
              parent: app.preview_of_slug,
              prNumber: app.preview_pr_number ?? 0,
              state: app.preview_pr_state,
              expiresAt: app.preview_expires_at,
            },
          ]
        : []
    );
    parents = apps.filter((app) => !app.preview_of_slug);
  }
  return {
    workspace,
    previews,
    parents,
    error: query.error,
    loading: !ready || query.isPending,
    refetch: () => void query.refetch(),
  };
}

function rowLabel(row: PreviewRow) {
  const name = row.prNumber
    ? `PR #${row.prNumber} of ${row.parent}`
    : `Developer preview of ${row.parent}`;
  return row.state ? `${name} · ${row.state}` : name;
}

/**
 * PR previews on Releases: the workspace's previews, one preview read by
 * slug, and creating one for a production app (B27).
 */
export function ReleasePreviews() {
  const availability = useCapability('pr-previews');
  const { workspace, previews, parents, error, loading, refetch } = useWorkspacePreviews();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState('');
  const canCreate = availability.state === 'available' && parents.length > 0;
  return (
    <Panel
      title="PR previews"
      help="Each preview is its own app, made from a production app's settings. It scales to zero and expires on its own."
      actions={
        canCreate && !creating ? (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            New preview
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {availability.state !== 'available' && (
          <CapabilityNotice
            capability={availability.capability}
            state={availability.state}
            onRetry={availability.refresh}
          />
        )}
        {canCreate && creating && (
          <NewPreviewForm
            parents={parents}
            org={workspace.org}
            label={workspace.label}
            onCancel={() => setCreating(false)}
            onCreated={(slug) => {
              setCreating(false);
              setSelected(slug);
            }}
          />
        )}
        <InlinePhase
          phase={queryPhase({ error, loading, isEmpty: previews.length === 0 })}
          error={error}
          loadingMessage="Loading previews…"
          emptyMessage={
            workspace.org
              ? `No previews in ${workspace.label} yet. Pull requests on a connected repository get one automatically.`
              : 'No previews yet. Pull requests on a connected repository get one automatically.'
          }
          onRetry={refetch}
        />
        {previews.length > 0 && workspace.org && (
          <p className="text-xs text-muted-foreground">
            {workspace.label}’s app list names each preview but not its pull request state or
            expiry; open one to read them.
          </p>
        )}
        {previews.length > 0 && (
          <ul className="divide-y divide-border well rounded-xl bg-muted/40">
            {previews.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  aria-pressed={row.slug === selected}
                  onClick={() => setSelected(row.slug === selected ? '' : row.slug)}
                  className="flex w-full min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50 aria-pressed:bg-muted/50"
                >
                  <span className="min-w-0 truncate font-mono font-medium">{row.slug}</span>
                  <span className="text-xs text-muted-foreground">
                    {rowLabel(row)}
                    {workspace.org ? null : (
                      <>
                        {' '}
                        · expires <Expiry iso={row.expiresAt} />
                      </>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected && (
          <PreviewDetail
            key={selected}
            slug={selected}
            org={workspace.org}
            label={workspace.label}
            onClose={() => setSelected('')}
          />
        )}
      </div>
    </Panel>
  );
}

/**
 * Creating, reading and tearing down a preview are not reviewed organization
 * routes, so for a company app apid lets only its creator through, while an
 * owner or admin (faas appaccess/access.go:263-270; organization-app-access.md
 * "preview-status … legacy operations still require the creator to be
 * owner/admin"). Other members get 403 `org_role_forbidden`.
 */
const creatorOnly = (parent: string, organization: string) =>
  `The API lets only the member who created ${parent} create its previews, while they are an owner or admin of ${organization}. Other members cannot create them yet.`;

function NewPreviewForm({
  parents,
  org,
  label,
  onCancel,
  onCreated,
}: {
  parents: ParentApp[];
  org: string | null;
  label: string;
  onCancel: () => void;
  onCreated: (slug: string) => void;
}) {
  const id = useId();
  const { account } = useAuth();
  const { toast } = useToast();
  const create = useCreatePreview();
  const [parent, setParent] = useState(parents[0]?.slug ?? '');
  const [pr, setPr] = useState('');
  const [ttl, setTtl] = useState(String(PREVIEW_TTL_DEFAULT_HOURS));
  const [failure, setFailure] = useState<unknown>(null);
  const prNumber = Number(pr);
  const prValid = /^\d+$/.test(pr) && prNumber > 0 && Number.isSafeInteger(prNumber);
  const ttlHours = Number(ttl);
  const ttlValid = /^\d+$/.test(ttl) && validPreviewTtl(ttlHours);
  // The server formats the number with %d, so leading zeros never reach the slug.
  const slug = pr ? previewSlugFor(parent, pr.replace(/^0+(?=\d)/, '')) : '';
  const slugTooLong = slug.length > PREVIEW_SLUG_MAX;
  const limit = account?.limits.preview_apps;
  const planName = account ? account.plan.charAt(0).toUpperCase() + account.plan.slice(1) : '';
  const code = failure instanceof ApiError ? failure.code : '';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!parent || !prValid || !ttlValid || slugTooLong) return;
    setFailure(null);
    try {
      const { app, created } = await create.mutateAsync({ parent, prNumber, ttlHours, org });
      toast(
        created
          ? { kind: 'success', title: `Preview ${app.slug} created` }
          : {
              kind: 'info',
              title: `Preview ${app.slug} already existed`,
              description: `It is open again and now expires ${leaseLabel(ttlHours)} from now.`,
            }
      );
      onCreated(app.slug);
    } catch (error) {
      setFailure(error);
    }
  };

  return (
    <form
      aria-label="New preview"
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-4 well rounded-xl bg-muted/40 p-4"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs text-muted-foreground">Production app</span>
          <Select value={parent} onChange={(event) => setParent(event.target.value)}>
            {parents.map((app) => (
              <option key={app.id} value={app.slug}>
                {app.slug}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs text-muted-foreground">Pull request number</span>
          <Input
            inputMode="numeric"
            autoComplete="off"
            placeholder="42"
            value={pr}
            onChange={(event) => setPr(event.target.value.trim())}
            aria-invalid={pr !== '' && !prValid}
            aria-describedby={pr !== '' && !prValid ? `${id}-pr` : undefined}
          />
          {pr !== '' && !prValid && (
            <FieldError id={`${id}-pr`}>Enter the pull request's number.</FieldError>
          )}
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs text-muted-foreground">Expires after (hours)</span>
          <Input
            type="number"
            min={1}
            max={PREVIEW_TTL_MAX_HOURS}
            step={1}
            value={ttl}
            onChange={(event) => setTtl(event.target.value)}
            aria-invalid={!ttlValid}
            aria-describedby={ttlValid ? undefined : `${id}-ttl`}
          />
          {!ttlValid && (
            <FieldError id={`${id}-ttl`}>
              Enter whole hours from 1 to {PREVIEW_TTL_MAX_HOURS}.
            </FieldError>
          )}
        </label>
      </div>
      <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
        {/* apid copies the parent's pr-preview values and secrets on create and
            reopen (faas ADR-20261028090000, handlers_preview_create.go:79). */}
        {slug && (
          <p>
            Creates <code className="font-mono text-foreground">{slug}</code>, undeployed, with{' '}
            {parent}'s settings. Production environment values are not copied. Values and secrets in{' '}
            {parent}'s pr-preview scope are applied to it.
          </p>
        )}
        {slugTooLong && (
          <FieldError id={`${id}-slug`}>
            The preview's name must be at most {PREVIEW_SLUG_MAX} characters.
          </FieldError>
        )}
        <p>
          It expires {leaseLabel(ttlValid ? ttlHours : PREVIEW_TTL_DEFAULT_HOURS)} after you create
          it; the default is {leaseLabel(PREVIEW_TTL_DEFAULT_HOURS)}. Creating it again for the same
          pull request renews it instead of adding another.
        </p>
        {/* A company's previews draw on its plan, not the member's own
            (organization-app-access.md "Application admission"). */}
        {!org && limit != null && (
          <p>
            Your {planName} plan allows {limit} open PR preview environment
            {limit === 1 ? '' : 's'}; a closed pull request's preview stops counting.
          </p>
        )}
        {org && (
          <p>
            In {label}, the API lets only the member who created an app create its previews, while
            they are an owner or admin. Previews count against {label}’s plan.
          </p>
        )}
      </div>
      {failure != null && (
        <div role="alert" className="flex flex-col gap-1 text-sm">
          <p style={{ color: 'var(--status-critical)' }}>
            {org && code === 'org_role_forbidden'
              ? creatorOnly(parent, label)
              : errorMessage(failure)}
          </p>
          {code === 'org_role_forbidden' && <ProblemHelp error={failure} />}
          {code === 'plan_limit_apps' && (
            <p className="text-muted-foreground">
              Open a preview below and tear it down, or close its pull request.{' '}
              <Link to="/dashboard/plans" className="text-brand underline">
                View plans
              </Link>
            </p>
          )}
          {code === 'email_verification_required' && (
            <Link to="/dashboard/account" className="text-brand underline">
              Verify your email
            </Link>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          size="sm"
          busy={create.isPending}
          disabled={!parent || !prValid || !ttlValid || slugTooLong || create.isPending}
        >
          Create preview
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}

/** The app-level facts every preview read has: URL, parent, pull request, expiry. */
function AppFacts({
  app,
  url,
  parentSlug,
}: {
  app: PreviewAppResponse;
  url?: string;
  parentSlug?: string;
}) {
  return (
    <>
      <Fact label="URL">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand hover:underline"
          >
            {url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
          </a>
        ) : (
          <span className="text-muted-foreground">Not assigned</span>
        )}
      </Fact>
      <Fact label="Production app">
        {parentSlug ? (
          <Link
            to="/dashboard/apps/$appSlug"
            params={{ appSlug: parentSlug }}
            className="text-brand hover:underline"
          >
            {parentSlug}
          </Link>
        ) : (
          '—'
        )}
      </Fact>
      <Fact label="Pull request">
        {app.preview_pr_number
          ? `PR #${app.preview_pr_number} · ${app.preview_pr_state ?? 'unknown'}`
          : 'Developer preview'}
      </Fact>
      <Fact label="Expires">
        <Expiry iso={app.preview_expires_at} />
      </Fact>
    </>
  );
}

function PreviewDetail({
  slug,
  org,
  label,
  onClose,
}: {
  slug: string;
  org: string | null;
  label: string;
  onClose: () => void;
}) {
  const query = usePreview(slug);
  const data = query.data;
  const notPreview = query.error instanceof ApiError && query.error.code === 'preview_not_found';
  const refused =
    Boolean(org) && query.error instanceof ApiError && query.error.code === 'org_role_forbidden';
  const url = data && publicAppUrl(data.links.url);
  const latest = data?.latest_deployment;
  const parentSlug = data?.parent?.slug ?? data?.app.preview_of_slug;
  const groups = data?.changes_from_production.configuration_changed_groups ?? [];
  return (
    <section
      aria-label={`Preview ${slug}`}
      className="flex flex-col gap-4 well rounded-xl bg-muted/40 p-4 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="min-w-0 truncate font-mono font-medium">{slug}</h3>
        <Button size="xs" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {refused ? (
        <CompanyPreviewFacts slug={slug} label={label} />
      ) : notPreview ? (
        <p className="text-muted-foreground">
          {slug} is not a preview app. Open it from Apps instead.
        </p>
      ) : (
        <InlinePhase
          phase={queryPhase({ error: query.error, loading: query.isPending })}
          error={query.error}
          loadingMessage="Reading preview…"
          onRetry={() => void query.refetch()}
        />
      )}
      {data && (
        <>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>
                {latest ? (
                  <ReleaseStatusLabel status={latest.status} />
                ) : (
                  <span className="font-medium">Not deployed yet</span>
                )}
              </dd>
            </div>
            <AppFacts app={data.app} url={url} parentSlug={parentSlug} />
            {latest && (
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Changes from production</dt>
                <dd>
                  Artifact {data.changes_from_production.artifact_changed ? 'changed' : 'unchanged'}
                  {' · '}
                  {groups.length ? groups.join(', ') : 'no configuration changes'}
                </dd>
              </div>
            )}
          </dl>
          {!latest && (
            <p className="text-muted-foreground">
              Deploy a branch to it from its Deployments tab, or from a terminal:{' '}
              <code className="font-mono break-words text-foreground">
                gregale preview create --app {parentSlug} --repo OWNER/NAME --ref BRANCH --pr-number{' '}
                {data.app.preview_pr_number}
              </code>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/dashboard/apps/$appSlug"
              params={{ appSlug: slug }}
              search={{ tab: 'Deployments' }}
              className="text-brand hover:underline"
            >
              Open {slug}
            </Link>
            <TearDownPreviewButton slug={slug} onDone={onClose} />
          </div>
        </>
      )}
    </section>
  );
}

/**
 * A company preview whose preview read apid refused: the reviewed app read
 * (`GET /v1/apps/{slug}`, faas appaccess/routes.go:28) still gives every
 * member its app-level facts. Its deployment, changes from production and
 * teardown sit behind the same refusal, so they are named, not offered.
 */
function CompanyPreviewFacts({ slug, label }: { slug: string; label: string }) {
  const app = useApp(slug);
  const parent = app.data?.preview_of_slug ?? parsePreviewSlug(slug)?.parent ?? 'its app';
  return (
    <>
      <InlinePhase
        phase={queryPhase({ error: app.error, loading: app.isPending })}
        error={app.error}
        loadingMessage="Reading preview…"
        onRetry={() => void app.refetch()}
      />
      {app.data && (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <AppFacts app={app.data} url={publicAppUrl(app.data.url)} parentSlug={parent} />
        </dl>
      )}
      <p role="status" className="text-muted-foreground">
        Only the member who created {parent}, while an owner or admin of {label}, can see this
        preview’s latest deployment and changes from production, or tear it down: the API has not
        opened those to other members yet.
      </p>
      {app.data && (
        <Link
          to="/dashboard/apps/$appSlug"
          params={{ appSlug: slug }}
          className="w-fit text-brand hover:underline"
        >
          Open {slug}
        </Link>
      )}
    </>
  );
}
