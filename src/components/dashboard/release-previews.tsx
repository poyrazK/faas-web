import { useId, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { Plus } from 'iconoir-react';
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
  previewSlugFor,
  useCreatePreview,
  usePreview,
  validPreviewTtl,
  type PreviewAppResponse,
} from '@/lib/api/pr-previews';
import { useApps } from '@/lib/api/queries';
import { publicAppUrl } from '@/lib/app-url';
import { useAuth } from '@/lib/auth';
import { CapabilityNotice } from './capability-notice';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { TearDownPreviewButton } from './preview-actions';
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

/**
 * PR previews on Releases: the previews the account has, one preview read by
 * slug, and creating one for a production app (B27).
 */
export function ReleasePreviews() {
  const availability = useCapability('pr-previews');
  const apps = useApps();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState('');
  const previews = (apps.data ?? []).filter((app) => app.preview_of_slug);
  const parents = (apps.data ?? []).filter((app) => !app.preview_of_slug);
  const canCreate = availability.state === 'available' && parents.length > 0;
  return (
    <Panel
      title="PR previews"
      description="Each preview is its own app, pr-<number>-<app>, made from a production app's settings. It scales to zero and expires on its own."
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
            onCancel={() => setCreating(false)}
            onCreated={(slug) => {
              setCreating(false);
              setSelected(slug);
            }}
          />
        )}
        <InlinePhase
          phase={queryPhase({
            error: apps.error,
            loading: apps.isPending,
            isEmpty: previews.length === 0,
          })}
          error={apps.error}
          loadingMessage="Loading previews…"
          emptyMessage="No previews yet. Pull requests on a connected repository get one automatically."
          onRetry={() => void apps.refetch()}
        />
        {previews.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {previews.map((app) => (
              <li key={app.id}>
                <button
                  type="button"
                  aria-pressed={app.slug === selected}
                  onClick={() => setSelected(app.slug === selected ? '' : app.slug)}
                  className="flex w-full min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50 aria-pressed:bg-muted/50"
                >
                  <span className="min-w-0 truncate font-mono font-medium">{app.slug}</span>
                  <span className="text-xs text-muted-foreground">
                    {app.preview_pr_number
                      ? `PR #${app.preview_pr_number} of ${app.preview_of_slug}`
                      : `Developer preview of ${app.preview_of_slug}`}
                    {app.preview_pr_state ? ` · ${app.preview_pr_state}` : ''} · expires{' '}
                    <Expiry iso={app.preview_expires_at} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected && (
          <PreviewDetail key={selected} slug={selected} onClose={() => setSelected('')} />
        )}
      </div>
    </Panel>
  );
}

function NewPreviewForm({
  parents,
  onCancel,
  onCreated,
}: {
  parents: PreviewAppResponse[];
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
      const { app, created } = await create.mutateAsync({ parent, prNumber, ttlHours });
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
      className="flex flex-col gap-4 rounded-md border border-border p-4"
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
        {limit != null && (
          <p>
            Your {planName} plan allows {limit} open PR preview environment
            {limit === 1 ? '' : 's'}; a closed pull request's preview stops counting.
          </p>
        )}
      </div>
      {failure != null && (
        <div role="alert" className="flex flex-col gap-1 text-sm">
          <p style={{ color: 'var(--status-critical)' }}>{errorMessage(failure)}</p>
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

function PreviewDetail({ slug, onClose }: { slug: string; onClose: () => void }) {
  const query = usePreview(slug);
  const data = query.data;
  const notPreview = query.error instanceof ApiError && query.error.code === 'preview_not_found';
  const url = data && publicAppUrl(data.links.url);
  const latest = data?.latest_deployment;
  const parentSlug = data?.parent?.slug ?? data?.app.preview_of_slug;
  const groups = data?.changes_from_production.configuration_changed_groups ?? [];
  return (
    <section
      aria-label={`Preview ${slug}`}
      className="flex flex-col gap-4 rounded-md border border-border p-4 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="min-w-0 truncate font-mono font-medium">{slug}</h3>
        <Button size="xs" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {notPreview ? (
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
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">URL</dt>
              <dd className="truncate">
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
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Production app</dt>
              <dd className="truncate">
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
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Pull request</dt>
              <dd>
                {data.app.preview_pr_number
                  ? `PR #${data.app.preview_pr_number} · ${data.app.preview_pr_state ?? 'unknown'}`
                  : 'Developer preview'}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Expires</dt>
              <dd>
                <Expiry iso={data.app.preview_expires_at} />
              </dd>
            </div>
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
