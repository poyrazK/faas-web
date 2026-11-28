import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useCopy } from '@/components/ui/copy-button';
import {
  issueReleaseReceiverInvite,
  issueReleaseSandboxRunInvite,
  listReleaseSandboxRuns,
  shareReleaseSandboxRun,
  startReleaseSandboxRun,
  type APISandboxReceiverInvite,
  type APISandboxRunMode,
  type APISandboxRunReport,
  type APISandboxScenario,
  sandboxScenarioLibraryKey,
} from '@/lib/api/api-sandboxes';
import { errorMessage } from '@/lib/api/errors';
import { SandboxRunReportDetails, sandboxRunStatus } from './api-sandbox-run-report';

const pending = (run: APISandboxRunReport) =>
  run.status === 'queued' ||
  run.status === 'running' ||
  run.status === 'awaiting_partner' ||
  run.status === 'awaiting_partner_outcome' ||
  run.status === 'checking_state';

const receiverStatuses: Record<APISandboxReceiverInvite['status'], string> = {
  pending: 'Waiting for the partner to verify their HTTPS endpoint.',
  verified: 'Endpoint verified. Waiting for the partner to install the signing secret.',
  ready: 'The partner is ready to receive the signed callback.',
  expired: 'This receiver invite has expired.',
};

export function SandboxRuns({
  slug,
  deployment,
  scenario,
}: {
  slug: string;
  deployment: string;
  scenario: APISandboxScenario | null;
}) {
  const client = useQueryClient();
  const queryKey = ['release-sandbox-runs', slug, deployment];
  const [link, setLink] = useState<{ id: string; url: string; expires?: string }>();
  const [receiverLink, setReceiverLink] = useState<{ id: string; url: string }>();
  const receiverClipboard = useCopy();
  const webhookRun = !!(scenario?.stripe_webhook || scenario?.outbound_webhook);
  const runLabel = scenario?.outbound_webhook
    ? 'Run outbound webhook scenario'
    : scenario?.stripe_webhook
      ? 'Run webhook scenario'
      : 'Run scenario';
  const requests = scenario?.requests ?? [];
  const finalRequest = requests.at(-1);
  const supportsPartnerRun =
    requests.length > 1 &&
    finalRequest?.method === 'GET' &&
    !!finalRequest.assertions?.length &&
    requests.slice(0, -1).every((request) => !request.assertions?.length);
  const clipboard = useCopy();
  const listing = useQuery({
    queryKey,
    queryFn: ({ signal }) => listReleaseSandboxRuns({ slug, deployment }, signal),
    refetchInterval: (query) =>
      query.state.data?.runs.some(pending) ||
      query.state.data?.receiver_invites?.some((invite) => invite.status !== 'expired')
        ? 2500
        : false,
  });
  const launch = useMutation({
    mutationFn: ({
      id,
      revision,
      mode,
      partnerWebhook,
    }: {
      id: string;
      revision: string;
      mode: APISandboxRunMode;
      partnerWebhook?: boolean;
    }) => {
      if (partnerWebhook) {
        return startReleaseSandboxRun({ slug, deployment }, id, revision, mode, true);
      }
      return mode === 'partner'
        ? startReleaseSandboxRun({ slug, deployment }, id, revision, mode)
        : startReleaseSandboxRun({ slug, deployment }, id, revision);
    },
    onSuccess: (run) => {
      client.setQueryData<{
        runs: APISandboxRunReport[];
        receiver_invites?: APISandboxReceiverInvite[];
      }>(queryKey, (prev) => ({
        runs: [run, ...(prev?.runs ?? []).filter((other) => other.id !== run.id)],
        receiver_invites: prev?.receiver_invites?.filter((invite) => invite.run_id !== run.id),
      }));
      void client.invalidateQueries({ queryKey });
    },
    onError: () => {
      void client.invalidateQueries({
        queryKey: ['release-api-sandbox-scenario', slug, deployment],
      });
      void client.invalidateQueries({ queryKey: sandboxScenarioLibraryKey(slug) });
    },
  });
  const share = useMutation({
    mutationFn: (id: string) => shareReleaseSandboxRun({ slug, deployment }, id),
    onSuccess: (response, id) => {
      const url = new URL(`/api-sandbox/${id}`, window.location.origin);
      url.hash = response.token;
      setLink({ id, url: url.toString(), expires: response.expires_at });
    },
  });
  const invite = useMutation({
    mutationFn: (id: string) => issueReleaseSandboxRunInvite({ slug, deployment }, id),
    onSuccess: (response, id) => {
      const url = new URL(`/api-sandbox/${id}`, window.location.origin);
      url.hash = response.token;
      setLink({ id, url: url.toString() });
    },
  });
  const receiverInvite = useMutation({
    mutationFn: async (revision: string) => {
      const id = crypto.randomUUID();
      const invite = await issueReleaseReceiverInvite({ slug, deployment }, id, revision);
      if (invite.token) {
        const url = new URL(`/api-sandbox/${id}`, window.location.origin);
        url.hash = invite.token;
        setReceiverLink({ id, url: url.toString() });
      }
      client.setQueryData<{
        runs: APISandboxRunReport[];
        receiver_invites?: APISandboxReceiverInvite[];
      }>(queryKey, (prev) => ({
        runs: prev?.runs ?? [],
        receiver_invites: [
          { ...invite, token: undefined },
          ...(prev?.receiver_invites ?? []).filter((other) => other.run_id !== id),
        ],
      }));
    },
    onSuccess: () => void client.invalidateQueries({ queryKey }),
  });
  const receiverSetups = (listing.data?.receiver_invites ?? []).filter(
    (invite) => invite.scenario_revision === scenario?.revision && invite.status !== 'expired'
  );
  const retry =
    launch.isError &&
    !launch.variables?.partnerWebhook &&
    launch.variables?.revision === scenario?.revision;
  function start(mode: APISandboxRunMode) {
    if (!scenario) return;
    launch.mutate(
      (retry && launch.variables?.mode === mode && launch.variables) || {
        id: crypto.randomUUID(),
        revision: scenario.revision,
        mode,
      }
    );
  }
  const failure =
    launch.error ?? share.error ?? invite.error ?? receiverInvite.error ?? listing.error;
  if (!scenario && !listing.data?.runs.length) return null;

  return (
    <section className="grid gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Scenario runs</h3>
          {scenario ? (
            <p className="text-xs text-muted-foreground">
              {scenario.outbound_webhook
                ? 'Run an async job and check its completion callback on a fresh copy.'
                : scenario.stripe_webhook
                  ? 'Check Stripe event delivery, duplicate handling, and final state on a fresh copy.'
                  : 'Run the saved checks against a fresh copy.'}
            </p>
          ) : null}
        </div>
        {scenario ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              busy={
                launch.isPending &&
                launch.variables?.mode === 'automated' &&
                !launch.variables.partnerWebhook
              }
              disabled={launch.isPending}
              onClick={() => start('automated')}
            >
              {retry && launch.variables?.mode === 'automated' ? 'Retry launch' : runLabel}
            </Button>
            {scenario.outbound_webhook ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                busy={receiverInvite.isPending}
                disabled={receiverInvite.isPending}
                onClick={() => receiverInvite.mutate(scenario.revision)}
              >
                Invite webhook partner
              </Button>
            ) : null}
            {!webhookRun ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                busy={launch.isPending && launch.variables?.mode === 'partner'}
                disabled={launch.isPending || !supportsPartnerRun}
                onClick={() => start('partner')}
              >
                {retry && launch.variables?.mode === 'partner'
                  ? 'Retry partner run'
                  : 'Start partner run'}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {scenario && !webhookRun && !supportsPartnerRun ? (
        <p className="text-xs text-muted-foreground">
          Partner runs need at least one request checked by HTTP status followed by a GET with a
          JSON assertion.
        </p>
      ) : null}
      {failure ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(failure)}
        </p>
      ) : null}
      {receiverSetups.map((setup) => (
        <div key={setup.run_id} className="grid gap-2 rounded-md border border-border p-3">
          <p className="text-sm" role="status">
            {receiverStatuses[setup.status]}
          </p>
          <p className="text-xs text-muted-foreground">
            Setup expires{' '}
            <time dateTime={setup.expires_at}>{new Date(setup.expires_at).toLocaleString()}</time>
          </p>
          {setup.status === 'pending' && receiverLink?.id === setup.run_id ? (
            <div className="flex gap-2">
              <input
                aria-label="Webhook receiver invite link"
                className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                value={receiverLink.url}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void receiverClipboard.copy(receiverLink.url)}
              >
                {receiverClipboard.copied ? 'Copied' : 'Copy receiver invite'}
              </Button>
            </div>
          ) : null}
          {setup.status === 'ready' ? (
            <div>
              <Button
                type="button"
                size="sm"
                busy={launch.isPending && launch.variables?.id === setup.run_id}
                disabled={launch.isPending}
                onClick={() =>
                  launch.mutate({
                    id: setup.run_id,
                    revision: setup.scenario_revision,
                    mode: 'automated',
                    partnerWebhook: true,
                  })
                }
              >
                Run with partner receiver
              </Button>
            </div>
          ) : null}
        </div>
      ))}
      {(listing.data?.runs ?? []).map((run) => {
        const canInvite =
          run.mode === 'partner' &&
          (run.status === 'queued' || run.status === 'awaiting_partner') &&
          run.steps.length === 0;
        return (
          <details key={run.id} className="rounded-md border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {run.scenario_name}
              {run.partner_webhook
                ? ' · Partner webhook'
                : run.mode === 'partner'
                  ? ' · Partner run'
                  : ''}{' '}
              · {sandboxRunStatus[run.status]}
            </summary>
            <div className="mt-3 grid gap-3">
              <SandboxRunReportDetails run={run} />
              {canInvite ? (
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    busy={invite.isPending && invite.variables === run.id}
                    disabled={invite.isPending}
                    onClick={() => invite.mutate(run.id)}
                  >
                    Create partner invite
                  </Button>
                </div>
              ) : null}
              {!pending(run) ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    busy={share.isPending && share.variables === run.id}
                    disabled={share.isPending}
                    onClick={() => share.mutate(run.id)}
                  >
                    Share report
                  </Button>
                </div>
              ) : null}
              {link?.id === run.id && (link.expires || canInvite) ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {link.expires ? (
                      <>
                        Link expires{' '}
                        <time dateTime={link.expires}>
                          {new Date(link.expires).toLocaleString()}
                        </time>
                      </>
                    ) : (
                      'The recipient can accept this invite once the sandbox is ready.'
                    )}
                  </p>
                  <div className="flex gap-2">
                    <input
                      aria-label={link.expires ? 'Scenario report link' : 'Partner invite link'}
                      className="min-w-0 flex-1 rounded-md border border-input px-2 text-xs"
                      value={link.url}
                      readOnly
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void clipboard.copy(link.url)}
                    >
                      {clipboard.copied ? 'Copied' : 'Copy link'}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </details>
        );
      })}
    </section>
  );
}
