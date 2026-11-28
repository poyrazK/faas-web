import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useCopy } from '@/components/ui/copy-button';
import { Input } from '@/components/ui/input';
import { SandboxScenarioEditor } from './api-sandbox-scenario';
import { SandboxScenarioLibrary } from './api-sandbox-scenario-library';
import { SandboxComparisons } from './api-sandbox-comparisons';
import { SandboxRuns } from './api-sandbox-runs';
import {
  endReleaseSandbox,
  ensureReleaseSandbox,
  getReleaseSandboxScenario,
  getSandboxLibraryScenario,
  issueReleaseSandboxInvite,
  issueReleaseSandboxPartnerInvite,
  revokeReleaseSandboxPartner,
  listReleaseSandboxes,
  listSandboxLibraryScenarios,
  releaseSandboxScenarioKey,
  sandboxLibraryScenarioKey,
  sandboxScenarioLibraryKey,
  saveReleaseSandboxScenario,
  type APISandbox,
} from '@/lib/api/api-sandboxes';
import { errorMessage } from '@/lib/api/errors';

const statuses: Record<APISandbox['status'], string> = {
  preparing_database: 'Preparing database',
  running_migrations: 'Running release migrations',
  starting_release: 'Starting release',
  verifying_api: 'Checking API',
  live: 'Ready to share',
  failed: 'Setup failed',
  tearing_down: 'Ending sandbox',
  ended: 'Ended',
};

function sandboxPending(sandbox: APISandbox) {
  const partner = sandbox.partner;
  return (
    !['live', 'failed', 'ended'].includes(sandbox.status) ||
    (sandbox.status === 'live' &&
      Date.parse(sandbox.expires_at) > Date.now() &&
      Boolean(partner?.invited_at && !partner.revoked_at && !partner.first_success_at))
  );
}

function sandboxReady(sandbox: APISandbox) {
  return (
    sandbox.status === 'live' &&
    sandbox.verification !== undefined &&
    sandbox.verification.deployment_id === sandbox.deployment_id
  );
}

export function ReleaseAPISandboxes({
  slug,
  deployment,
  initialOpen = false,
  initialScenario,
}: {
  slug: string;
  deployment: string;
  initialOpen?: boolean;
  initialScenario?: string;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <details
      className="well rounded-xl bg-muted/40 p-4"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm font-medium">API sandboxes</summary>
      {open ? (
        <ReleaseSandboxControls
          key={`${slug}/${deployment}/${initialScenario ?? ''}`}
          slug={slug}
          deployment={deployment}
          initialScenario={initialScenario}
        />
      ) : null}
    </details>
  );
}

function ReleaseSandboxControls({
  slug,
  deployment,
  initialScenario,
}: {
  slug: string;
  deployment: string;
  initialScenario?: string;
}) {
  const client = useQueryClient();
  const queryKey = ['release-api-sandboxes', slug, deployment];
  const scenarioKey = releaseSandboxScenarioKey({ slug, deployment });
  const [smokePath, setSmokePath] = useState('');
  const [partnerLabel, setPartnerLabel] = useState('');
  const [invite, setInvite] = useState<{ id: string; link: string; oneTime: boolean }>();
  const [ending, setEnding] = useState<string>();
  const [clipboardDenied, setClipboardDenied] = useState(false);
  const [selected, setSelected] = useState(initialScenario ?? '');
  const clipboard = useCopy();
  const listing = useQuery({
    queryKey,
    queryFn: ({ signal }) => listReleaseSandboxes({ slug, deployment }, signal),
    refetchInterval: (query) => (query.state.data?.sandboxes.some(sandboxPending) ? 5_000 : false),
  });
  const refresh = () => client.invalidateQueries({ queryKey });
  const scenarioQuery = useQuery({
    queryKey: scenarioKey,
    queryFn: ({ signal }) => getReleaseSandboxScenario({ slug, deployment }, signal),
  });
  const library = useQuery({
    queryKey: sandboxScenarioLibraryKey(slug),
    queryFn: ({ signal }) => listSandboxLibraryScenarios(slug, signal),
  });
  const libraryScenario = useQuery({
    queryKey: sandboxLibraryScenarioKey(slug, selected),
    queryFn: ({ signal }) => getSandboxLibraryScenario(slug, selected, signal),
    enabled: !!selected,
  });
  const scenario =
    (selected ? libraryScenario.data?.scenario : scenarioQuery.data?.scenario) ?? null;
  const showInvite = (id: string, token: string, oneTime: boolean) => {
    const link = new URL(`/api-sandbox/${id}`, window.location.origin);
    link.hash = token;
    setInvite({ id, link: link.toString(), oneTime });
    setClipboardDenied(false);
  };
  const create = useMutation({
    mutationFn: async ({
      id,
      path,
      revision,
      label,
    }: {
      id: string;
      path: string;
      revision?: string;
      label?: string;
    }) => {
      if (!label) return ensureReleaseSandbox({ slug, deployment }, id, path, revision);
      const sandbox = await ensureReleaseSandbox({ slug, deployment }, id, path, revision, label);
      const data = await issueReleaseSandboxPartnerInvite({ slug, deployment }, sandbox.id);
      showInvite(sandbox.id, data.token, true);
      return sandbox;
    },
    onSuccess: () => void refresh(),
    onError: (_, { revision }) => {
      void refresh();
      if (revision) void client.invalidateQueries({ queryKey: scenarioKey });
    },
  });
  const path = smokePath.trim();
  const retry = (revision?: string, label?: string) =>
    create.isError &&
    create.variables?.path === path &&
    create.variables.revision === revision &&
    create.variables.label === label;
  const start = (revision?: string, label?: string) => {
    if (create.isPending) return;
    const previous = retry(revision, label) ? create.variables : undefined;
    create.mutate(previous ?? { id: crypto.randomUUID(), path, revision, label });
  };
  const generate = useMutation({
    mutationFn: async ({ id, partner }: { id: string; partner?: boolean }) => {
      const data = partner
        ? await issueReleaseSandboxPartnerInvite({ slug, deployment }, id)
        : await issueReleaseSandboxInvite({ slug, deployment }, id);
      showInvite(id, data.token, Boolean(partner));
    },
    onSuccess: (_, { partner }) => {
      if (partner) void refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeReleaseSandboxPartner({ slug, deployment }, id),
    onSuccess: (_, id) => {
      setInvite((current) => (current?.id === id ? undefined : current));
      void refresh();
    },
  });
  const end = useMutation({
    mutationFn: (id: string) => endReleaseSandbox({ slug, deployment }, id),
    onSuccess: (_, id) => {
      setEnding(undefined);
      setInvite((current) => (current?.id === id ? undefined : current));
      void refresh();
    },
  });

  const failure = create.error ?? generate.error ?? revoke.error ?? end.error ?? listing.error;
  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="max-w-lg text-sm text-muted-foreground">
        Run this release for 24 hours with a fresh PostgreSQL database. The release command should
        prepare the schema and sample data for your guests.
      </p>
      {library.isSuccess ? (
        <SandboxScenarioLibrary
          slug={slug}
          scenarios={library.data.scenarios}
          selected={selected}
          entry={libraryScenario.data}
          loadError={libraryScenario.error}
          onSelect={setSelected}
        />
      ) : library.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(library.error)}
        </p>
      ) : null}
      {!selected && scenarioQuery.isSuccess ? (
        <SandboxScenarioEditor
          scenario={scenario}
          saveScenario={(input) => saveReleaseSandboxScenario({ slug, deployment }, input)}
          sourceRequestId={scenarioQuery.data.source_request_id}
          onSave={(saved) => client.setQueryData(scenarioKey, saved)}
        />
      ) : !selected && scenarioQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(scenarioQuery.error)}
        </p>
      ) : null}
      <SandboxRuns slug={slug} deployment={deployment} scenario={scenario} />
      <SandboxComparisons slug={slug} deployment={deployment} revision={scenario?.revision} />
      <form
        className="flex max-w-lg flex-col items-start gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (scenario && partnerLabel.trim()) start(scenario.revision, partnerLabel.trim());
          else if (!scenario) start();
        }}
      >
        <label className="flex w-full max-w-xs flex-col gap-1.5 text-sm">
          Smoke test path (optional)
          <Input
            type="text"
            placeholder="/notes"
            maxLength={512}
            value={smokePath}
            disabled={create.isPending}
            onChange={(event) => setSmokePath(event.target.value)}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Sharing unlocks after GET /openapi.json and any smoke test pass. Setup continues in the
          background.
        </p>
        <div className="flex flex-wrap gap-2">
          {scenario ? (
            <Button
              type="button"
              size="sm"
              busy={
                create.isPending &&
                create.variables?.revision === scenario.revision &&
                !create.variables.label
              }
              disabled={create.isPending}
              onClick={() => start(scenario.revision)}
            >
              {retry(scenario.revision) ? 'Retry fresh copy' : 'Create fresh copy'}
            </Button>
          ) : null}
          <Button
            type={scenario ? 'button' : 'submit'}
            size="sm"
            onClick={scenario ? () => start() : undefined}
            variant={scenario ? 'outline' : 'default'}
            busy={create.isPending && !create.variables?.revision}
            disabled={create.isPending}
          >
            {retry() ? 'Retry sandbox creation' : 'Create sandbox'}
          </Button>
        </div>
        {scenario ? (
          <div className="flex w-full flex-wrap items-end gap-2">
            <label className="flex min-w-48 flex-1 flex-col gap-1.5 text-sm">
              Partner label
              <Input
                type="text"
                placeholder="Example partner"
                maxLength={100}
                value={partnerLabel}
                disabled={create.isPending}
                onChange={(event) => setPartnerLabel(event.target.value)}
              />
            </label>
            <Button
              type="submit"
              size="sm"
              disabled={!partnerLabel.trim() || create.isPending}
              busy={create.isPending && Boolean(create.variables?.label)}
            >
              {retry(scenario.revision, partnerLabel.trim())
                ? 'Retry partner invite'
                : 'Invite partner'}
            </Button>
          </div>
        ) : null}
      </form>
      {failure ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(failure)}
        </p>
      ) : null}
      {listing.isPending ? (
        <p role="status" className="text-sm">
          Loading sandboxes…
        </p>
      ) : null}
      {(listing.data?.sandboxes ?? []).map((sandbox) => (
        <div key={sandbox.id} className="rounded-lg border border-border bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p role="status" className="text-sm font-medium">
                {statuses[sandbox.status] ?? sandbox.status}
              </p>
              <p className="text-xs text-muted-foreground">
                {sandbox.id.slice(0, 8)} · Expires{' '}
                <time dateTime={sandbox.expires_at}>
                  {new Date(sandbox.expires_at).toLocaleString()}
                </time>
              </p>
              {sandbox.scenario ? (
                <p className="mt-1 text-xs text-muted-foreground">{sandbox.scenario.name}</p>
              ) : null}
              {sandbox.partner ? <PartnerProgress partner={sandbox.partner} /> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {sandboxReady(sandbox) && !sandbox.partner ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  busy={generate.isPending && generate.variables?.id === sandbox.id}
                  disabled={generate.isPending}
                  onClick={() => generate.mutate({ id: sandbox.id })}
                >
                  Create invite
                </Button>
              ) : null}
              {sandbox.partner &&
              sandbox.status !== 'ended' &&
              sandbox.status !== 'tearing_down' &&
              sandbox.status !== 'failed' ? (
                !sandbox.partner.redeemed_at || sandbox.partner.revoked_at ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    busy={generate.isPending && generate.variables?.id === sandbox.id}
                    disabled={generate.isPending || revoke.isPending}
                    onClick={() => generate.mutate({ id: sandbox.id, partner: true })}
                  >
                    {sandbox.partner.invited_at && !sandbox.partner.revoked_at
                      ? 'Replace one-time link'
                      : 'Create one-time link'}
                  </Button>
                ) : null
              ) : null}
              {sandbox.partner?.invited_at &&
              !sandbox.partner.revoked_at &&
              sandbox.status !== 'ended' &&
              sandbox.status !== 'tearing_down' ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  busy={revoke.isPending && revoke.variables === sandbox.id}
                  disabled={revoke.isPending || generate.isPending}
                  onClick={() => revoke.mutate(sandbox.id)}
                >
                  Revoke partner access
                </Button>
              ) : null}
              {sandbox.status !== 'ended' && sandbox.status !== 'tearing_down' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setEnding(sandbox.id)}
                >
                  End sandbox
                </Button>
              ) : null}
            </div>
          </div>
          {sandbox.status === 'failed' && sandbox.failure ? (
            <p className="mt-2 text-sm text-destructive">
              {sandbox.failure.detail}
              {sandbox.failure.http_status ? ` (HTTP ${sandbox.failure.http_status})` : ''}
            </p>
          ) : null}
          {sandboxReady(sandbox) ? (
            <p className="mt-2 text-xs text-muted-foreground">
              OpenAPI verified
              {sandbox.smoke_path ? ` · GET ${sandbox.smoke_path} passed` : ''}
            </p>
          ) : null}
          {ending === sandbox.id ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <p className="text-xs">End this sandbox and revoke all its invites?</p>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                busy={end.isPending}
                onClick={() => end.mutate(sandbox.id)}
              >
                End and revoke
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEnding(undefined)}>
                Cancel
              </Button>
            </div>
          ) : null}
          {invite?.id === sandbox.id &&
          (invite.oneTime
            ? sandbox.status !== 'ended' &&
              sandbox.status !== 'tearing_down' &&
              !sandbox.partner?.revoked_at &&
              !sandbox.partner?.redeemed_at
            : sandboxReady(sandbox)) ? (
            <div className="mt-3 flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                {invite.oneTime
                  ? 'This link can be redeemed once after the copy is ready.'
                  : 'Anyone with this link can use this sandbox until it expires.'}
              </p>
              <div className="flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                  aria-label="Private sandbox invitation link"
                  readOnly
                  value={invite.link}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={async () => setClipboardDenied(!(await clipboard.copy(invite.link)))}
                >
                  {clipboard.copied ? 'Copied' : 'Copy invite'}
                </Button>
              </div>
              {clipboardDenied ? (
                <p role="status" className="text-xs">
                  Select the link to copy it manually.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function PartnerProgress({ partner }: { partner: NonNullable<APISandbox['partner']> }) {
  const status = partner.revoked_at
    ? 'Access revoked'
    : partner.redeemed_at
      ? 'Invite redeemed'
      : partner.invited_at
        ? 'Waiting for redemption'
        : 'Invite not issued';
  return (
    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
      <p>
        {partner.label} · {status}
      </p>
      {partner.first_success_at ? (
        <p>
          First successful request{' '}
          <time dateTime={partner.first_success_at}>
            {new Date(partner.first_success_at).toLocaleString()}
          </time>
        </p>
      ) : partner.redeemed_at && !partner.revoked_at ? (
        <p>Waiting for the first successful request</p>
      ) : null}
    </div>
  );
}
