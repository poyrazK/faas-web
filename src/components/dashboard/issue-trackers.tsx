import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Circle, OpenNewWindow, Trash, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { FIELD } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  configureLinearOnce,
  createLinearTicketOnce,
  linearConnectionKey,
  removeTrackerLink,
  saveTrackerLink,
  trackerLinksKey,
  useLinearConnection,
  useTrackerLinks,
  type LinearConnection,
  type TicketResult,
} from '@/lib/api/issue-trackers';
import { useIssueDetail } from '@/lib/api/issues';
import { CliCommand } from './cli-command';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { ProblemHelp } from './problem-help';
import { StatusTag } from './postgres-shared';

/**
 * Linear for Issues (faas docs/issues.md § Connect a Linear team, § Native
 * Linear ticket creation, § GitHub and Linear tracker links), gated on
 * `issue-trackers` by the caller.
 *
 * The personal API key and webhook secret are write-only: typed into this
 * form, sent once by direct call, cleared on success, and never returned or
 * cached. Only the app owner may manage the connection (403 `forbidden`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A tracker failure in words, branched on apid's codes (pkg/apid/issuetrackers, handlers). */
export function explainTrackerError(err: unknown): string {
  if (!(err instanceof ApiError)) return errorMessage(err);
  switch (err.code) {
    case 'forbidden':
      return 'Only the app owner can manage the Linear connection or use it to create tickets.';
    case 'issue_tracker_linear_verification_failed':
      return 'Linear did not verify that key and team. Check the personal API key and the active team UUID.';
    case 'issue_tracker_linear_connection_changed':
      return 'The connection changed since this page read it. Reload it and try again.';
    case 'issue_tracker_connection_required':
      return 'Connect the app owner’s Linear team before creating tickets.';
    case 'issue_tracker_connection_changed':
      return 'The issue group or the Linear connection changed. Review it before trying again.';
    case 'issue_tracker_creation_unconfirmed':
      return 'Linear did not confirm whether the ticket was created. Wait 15 seconds, then recover it by its request ID; do not start a new one.';
    case 'issue_tracker_request_conflict':
      return 'That request ID was used with different inputs or another connection. Keep the original inputs to recover it.';
    case 'issue_tracker_creation_rejected':
      return 'Linear rejected the ticket. Fix the input and start a new request.';
    case 'issue_tracker_provider_unavailable':
      return 'Linear could not be reached or the stored credential is unavailable.';
    case 'issue_quota_exceeded':
      return 'This issue group already has its maximum of tracker references or ticket requests.';
    default:
      return errorMessage(err);
  }
}

function Problem({ error }: { error: unknown }) {
  if (error === undefined) return null;
  return (
    <div role="alert" className="flex flex-col gap-1 text-sm">
      <span style={{ color: 'var(--status-critical)' }}>{explainTrackerError(error)}</span>
      <ProblemHelp error={error} />
    </div>
  );
}

export function LinearConnectionPanel({ accountId, slug }: { accountId: string; slug: string }) {
  const query = useLinearConnection(accountId, slug);
  const phase = queryPhase({ error: query.error, loading: query.isPending });
  return (
    <section aria-label="Linear" className="flex min-w-0 flex-col gap-5">
      <div>
        <h3 className="text-base font-semibold">Linear</h3>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Connect the app owner’s Linear team so issue pages can create Linear tickets without a
          local key. Connecting stores a verified personal API key for one active team; it does not
          turn on status sync or write anything to Linear.
        </p>
      </div>
      <Panel title="Connection">
        {phase !== 'ready' || !query.data ? (
          <InlinePhase
            phase={phase === 'ready' ? 'loading' : phase}
            error={query.error}
            loadingMessage="Reading the Linear connection…"
            onRetry={() => void query.refetch()}
          />
        ) : (
          <ConnectionBody
            key={query.data.revision}
            accountId={accountId}
            slug={slug}
            connection={query.data}
            onReload={() => void query.refetch()}
          />
        )}
      </Panel>
      <p className="text-xs text-muted-foreground">
        Slack alert routing, Linear OAuth, status sync and provider callbacks are not in the console
        yet; status sync is <code className="font-mono">gregale debug issue tickets sync</code>.
      </p>
    </section>
  );
}

function ConnectionBody({
  accountId,
  slug,
  connection,
  onReload,
}: {
  accountId: string;
  slug: string;
  connection: LinearConnection;
  onReload: () => void;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [teamId, setTeamId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const teamOk = UUID.test(teamId.trim());
  const secretOk =
    webhookSecret === '' || (webhookSecret.length >= 32 && webhookSecret.length <= 4096);
  const ready = teamOk && apiKey.length > 0 && apiKey.length <= 4096 && secretOk;
  const store = (answer: LinearConnection) =>
    qc.setQueryData(linearConnectionKey(accountId, slug), answer);

  const connect = async () => {
    if (!ready || busy) return;
    if (
      connection.connected &&
      !(await confirm({
        title: 'Replace the Linear connection?',
        description:
          'The stored key is replaced. Leaving the webhook secret empty turns Linear callbacks off.',
        confirmLabel: 'Replace connection',
      }))
    )
      return;
    setBusy(true);
    setFailure(undefined);
    try {
      const answer = await configureLinearOnce(slug, {
        connected: true,
        expected_revision: connection.revision,
        team_id: teamId.trim(),
        api_key: apiKey,
        ...(webhookSecret ? { webhook_secret: webhookSecret } : {}),
      });
      setApiKey('');
      setWebhookSecret('');
      store(answer);
      toast({ kind: 'success', title: 'Linear connected' });
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (
      !(await confirm({
        title: 'Disconnect Linear?',
        description:
          'The stored key is erased. Tickets already created stay in Linear, and existing references stay on their issues.',
        confirmLabel: 'Disconnect',
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    setFailure(undefined);
    try {
      store(
        await configureLinearOnce(slug, {
          connected: false,
          expected_revision: connection.revision,
        })
      );
      toast({ kind: 'success', title: 'Linear disconnected' });
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(false);
    }
  };

  const stale =
    failure instanceof ApiError && failure.code === 'issue_tracker_linear_connection_changed';
  return (
    <div className="flex flex-col gap-4">
      {connection.connected ? (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="label-mono text-muted-foreground">State</dt>
            <dd>
              {connection.oauth_status === 'reconnect_required' ? (
                <StatusTag tone="warning" icon={WarningTriangle}>
                  Reconnect required
                </StatusTag>
              ) : (
                <StatusTag tone="good" icon={CheckCircle}>
                  Connected ({connection.auth_method === 'oauth' ? 'OAuth' : 'API key'})
                </StatusTag>
              )}
            </dd>
          </div>
          {connection.team_id && (
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="label-mono text-muted-foreground">Team</dt>
              <dd>
                <CopyableId value={connection.team_id} label="Linear team ID" />
              </dd>
            </div>
          )}
          {connection.workspace_id && (
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="label-mono text-muted-foreground">Workspace</dt>
              <dd>
                <CopyableId value={connection.workspace_id} label="Linear workspace ID" />
              </dd>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <dt className="label-mono text-muted-foreground">Callbacks</dt>
            <dd className="text-xs">
              {connection.webhook_enabled ? (
                <>
                  On at <code className="font-mono">{connection.callback_path}</code>
                </>
              ) : (
                'Off'
              )}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Circle aria-hidden className="h-3.5 w-3.5" />
          Not connected.
        </p>
      )}

      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void connect();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Team UUID</span>
            <input
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              placeholder="Active Linear team"
              className={`${FIELD} font-mono`}
              aria-invalid={teamId && !teamOk ? true : undefined}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Personal API key</span>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className={`${FIELD} font-mono`}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Webhook secret (optional)</span>
            <input
              type="password"
              autoComplete="off"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              className={`${FIELD} font-mono`}
              aria-invalid={secretOk ? undefined : true}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          The key is verified against the workspace, its user and the active team, then sealed. It
          is never shown again. A webhook secret is at least 32 characters.
        </p>
        <Problem error={failure} />
        {stale && (
          <Button variant="outline" size="sm" className="self-start" onClick={onReload}>
            Reload connection
          </Button>
        )}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" size="sm" disabled={!ready || busy}>
            {connection.connected ? 'Replace connection' : 'Connect Linear'}
          </Button>
          {connection.connected && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void disconnect()}
            >
              Disconnect
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

/**
 * GitHub and Linear references on one issue group, and a Linear ticket
 * through the stored connection. A reference is only a stored link: adding
 * or removing one never contacts the provider.
 */
export function IssueTrackerLinks({
  accountId,
  slug,
  issueId,
}: {
  accountId: string;
  slug: string;
  issueId: string;
}) {
  // The same read the detail above makes, so it comes from the cache.
  const issueTitle = useIssueDetail(accountId, slug, issueId).data?.issue.title;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const links = useTrackerLinks(accountId, slug, issueId);
  const connection = useLinearConnection(accountId, slug);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const rows = links.data?.pages.flatMap((p) => p.items) ?? [];
  const phase = queryPhase({
    error: links.error,
    loading: links.isPending,
    isEmpty: rows.length === 0,
  });
  const refresh = () =>
    qc.invalidateQueries({ queryKey: trackerLinksKey(accountId, slug, issueId) });
  const urlOk =
    /^https:\/\/(github\.com\/[^/]+\/[^/]+\/issues\/\d+|linear\.app\/[^/]+\/issue\/[A-Za-z0-9]+-\d+)/.test(
      url.trim()
    );

  const add = async () => {
    if (!urlOk || busy) return;
    setBusy(true);
    setFailure(undefined);
    try {
      await saveTrackerLink(slug, issueId, {
        url: url.trim(),
        ...(title.trim() ? { title: title.trim() } : {}),
      });
      setUrl('');
      setTitle('');
      await refresh();
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, label: string) => {
    if (
      !(await confirm({
        title: `Remove ${label}?`,
        description: 'Only the reference is removed; the ticket itself is unchanged.',
        confirmLabel: 'Remove reference',
        destructive: true,
      }))
    )
      return;
    try {
      await removeTrackerLink(slug, issueId, id);
      await refresh();
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Could not remove',
        description: explainTrackerError(err),
        error: err,
      });
    }
  };

  return (
    <section
      aria-label="Tracker links"
      className="flex min-w-0 flex-col gap-3 rounded border border-border p-3"
    >
      <h4 className="text-sm font-semibold">Tracker links</h4>
      {phase === 'ready' ? (
        <ul className="flex flex-col gap-1.5 text-sm">
          {rows.map((link) => (
            <li key={link.id} className="flex flex-wrap items-center justify-between gap-2">
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-1 text-brand hover:underline"
              >
                <span className="truncate">
                  {link.provider === 'linear' ? 'Linear' : 'GitHub'} {link.external_key}
                  {link.title ? ` · ${link.title}` : ''}
                </span>
                <OpenNewWindow aria-hidden className="h-3 w-3 shrink-0" />
              </a>
              <Button
                variant="ghost"
                size="xs"
                aria-label={`Remove ${link.external_key}`}
                onClick={() => void remove(link.id, link.external_key)}
              >
                <Trash aria-hidden className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <InlinePhase
          phase={phase}
          error={links.error}
          loadingMessage="Reading tracker links…"
          emptyMessage="No GitHub or Linear ticket is linked to this issue."
          onRetry={() => void links.refetch()}
        />
      )}
      {links.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => void links.fetchNextPage()}
        >
          More links
        </Button>
      )}
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-xs">
          <span className="label-mono text-muted-foreground">Ticket URL</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://linear.app/acme/issue/ENG-42"
            className={`${FIELD} font-mono`}
            aria-invalid={url && !urlOk ? true : undefined}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="label-mono text-muted-foreground">Title (optional)</span>
          <input
            value={title}
            maxLength={256}
            onChange={(e) => setTitle(e.target.value)}
            className={FIELD}
          />
        </label>
        <Button variant="outline" disabled={!urlOk || busy} onClick={() => void add()}>
          Link ticket
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Public GitHub issue and Linear issue URLs only; linking does not contact the provider or
        sync status.
      </p>
      <Problem error={failure} />
      {connection.data?.connected && connection.data.team_id && issueTitle !== undefined && (
        <LinearTicketForm
          slug={slug}
          issueId={issueId}
          teamId={connection.data.team_id}
          defaultTitle={issueTitle}
          onLinked={() => void refresh()}
        />
      )}
    </section>
  );
}

/**
 * Create a Linear ticket through the stored connection. One request ID, a
 * UUID v4 that Linear uses as the issue ID, is kept for every retry of the
 * same inputs, so an uncertain create is recovered rather than duplicated
 * (docs/issues.md § Native Linear ticket creation). The inputs lock once a
 * request has been sent.
 */
function LinearTicketForm({
  slug,
  issueId,
  teamId,
  defaultTitle,
  onLinked,
}: {
  slug: string;
  issueId: string;
  teamId: string;
  defaultTitle: string;
  onLinked: () => void;
}) {
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState(defaultTitle.slice(0, 256));
  const [description, setDescription] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TicketResult>();
  const [failure, setFailure] = useState<unknown>();
  const [recoverAt, setRecoverAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);
  useEffect(() => {
    if (!recoverAt || now >= recoverAt) return;
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [recoverAt, now]);
  const unconfirmed =
    failure instanceof ApiError && failure.code === 'issue_tracker_creation_unconfirmed';

  const send = async (recover: boolean) => {
    if (busy || !title.trim()) return;
    setBusy(true);
    setSent(true);
    setFailure(undefined);
    try {
      const answer = await createLinearTicketOnce(slug, issueId, {
        request_id: requestId,
        team_id: teamId,
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(recover ? { recover: true } : {}),
      });
      if (!mounted.current) return;
      setResult(answer);
      if (answer.state === 'linked') onLinked();
    } catch (err) {
      if (!mounted.current) return;
      setFailure(err);
      if (err instanceof ApiError && err.code === 'issue_tracker_creation_unconfirmed') {
        setRecoverAt(Date.now() + 15_000);
        setNow(Date.now());
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const startOver = () => {
    setRequestId(crypto.randomUUID());
    setSent(false);
    setResult(undefined);
    setFailure(undefined);
    setRecoverAt(0);
  };

  const rejected =
    failure instanceof ApiError && failure.code === 'issue_tracker_creation_rejected';
  const waiting = recoverAt > now;
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <h5 className="text-sm font-medium">Create a Linear ticket</h5>
      <label className="flex flex-col gap-1 text-xs">
        <span className="label-mono text-muted-foreground">Ticket title</span>
        <input
          value={title}
          maxLength={256}
          disabled={sent}
          onChange={(e) => setTitle(e.target.value)}
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="label-mono text-muted-foreground">Description (optional)</span>
        <textarea
          value={description}
          maxLength={16384}
          disabled={sent}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Nothing from the issue is copied unless you write it here. Request{' '}
        <CopyableId value={requestId} label="ticket request ID" />
      </p>
      {result?.state === 'linked' && (
        <p role="status" className="flex flex-wrap items-center gap-2 text-sm">
          <StatusTag tone="good" icon={CheckCircle}>
            Linked
          </StatusTag>
          <a
            href={result.ticket_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand hover:underline"
          >
            {result.ticket_url}
          </a>
        </p>
      )}
      {result?.state === 'created' && (
        <p role="status" className="text-sm">
          The ticket exists in Linear but is not attached yet. Send again with the same inputs to
          attach it.
        </p>
      )}
      <Problem error={failure} />
      <div className="flex flex-wrap gap-2">
        {result?.state !== 'linked' && !unconfirmed && !rejected && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !title.trim()}
            onClick={() => void send(false)}
          >
            {sent ? 'Send again' : 'Create ticket'}
          </Button>
        )}
        {unconfirmed && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || waiting}
            onClick={() => void send(true)}
          >
            {waiting ? `Recover in ${Math.ceil((recoverAt - now) / 1000)} s` : 'Recover ticket'}
          </Button>
        )}
        {(result?.state === 'linked' || rejected) && (
          <Button size="sm" variant="ghost" onClick={startOver}>
            New ticket
          </Button>
        )}
      </div>
      {unconfirmed && (
        <CliCommand
          label="Or recover from the CLI with the same request:"
          command={`gregale debug issue tickets create --app ${slug} --issue ${issueId} --provider linear --target ${teamId} --title '${title.replace(/'/g, "'\\''")}' --request-id ${requestId} --native --recover`}
          copyLabel={`Linear recovery command for ${requestId}`}
        />
      )}
    </div>
  );
}
