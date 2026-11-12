import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Input } from '@/components/ui/input';
import { OneTimeSecret, useOneTimeSecret } from '@/components/ui/one-time-secret';
import { useToast } from '@/components/ui/toast';
import { CopyableId } from '@/components/ui/copyable-id';
import { Timestamp } from '@/components/ui/timestamp';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { ApiError } from '@/lib/api/errors';
import {
  TICKET_MAX_CHANNELS,
  TICKET_MAX_TTL,
  issueRealtimeTicket,
  useChangeRealtimeAccess,
  useRealtimeAccess,
  useRealtimePushProviders,
  useRevokePrincipalTickets,
  useRevokeRealtimeTicket,
  type RealtimeAuthMode,
} from '@/lib/api/realtime';
import { channelError, explainToast, parseChannels, Section, StatusTag } from './realtime-shared';

/**
 * Who may read: subscription tickets, per-principal access controls, and the
 * push providers configured for offline delivery.
 *
 * A ticket is a bearer credential your backend would normally mint for a
 * signed-in user (docs/realtime.md § Subscription tickets); the console mints
 * one to test a client. apid returns it once with no-store
 * (handlers_tickets.go:14), so it is shown through `OneTimeSecret`, never
 * cached, and only its `ticket_id` is kept on screen for revocation.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Issued {
  ticket_id: string;
  principal: string;
  channels: string[];
  expires_at: string;
}

export function TicketsSection({ slug, endpointId }: { slug: string; endpointId: string }) {
  const id = useId();
  const evidence = useOneTimeSecret<string>();
  const revoke = useRevokeRealtimeTicket(slug, endpointId);
  const revokeAll = useRevokePrincipalTickets(slug, endpointId);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [principal, setPrincipal] = useState('');
  const [channelsText, setChannelsText] = useState('');
  const [ttl, setTtl] = useState('120');
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<Issued[]>([]);
  const [ticketId, setTicketId] = useState('');
  const [logoutPrincipal, setLogoutPrincipal] = useState('');
  const channels = parseChannels(channelsText);
  const ttlNumber = Number(ttl);
  const errors = {
    principal: !principal.trim()
      ? 'Name the user the ticket is for, as your backend knows them.'
      : principal.length > 256
        ? 'Use 256 characters or fewer.'
        : undefined,
    channels:
      channels.length === 0
        ? 'Name at least one channel.'
        : channels.length > TICKET_MAX_CHANNELS
          ? `At most ${TICKET_MAX_CHANNELS} channels.`
          : channels.map(channelError).find(Boolean),
    ttl:
      Number.isInteger(ttlNumber) && ttlNumber >= 1 && ttlNumber <= TICKET_MAX_TTL
        ? undefined
        : `A whole number of seconds from 1 to ${TICKET_MAX_TTL}.`,
  };
  const shown = (k: keyof typeof errors) => (attempted ? errors[k] : undefined);

  const issue = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (Object.values(errors).some(Boolean) || busy) return;
    const receive = evidence.capture();
    setBusy(true);
    try {
      const ticket = await issueRealtimeTicket(slug, endpointId, {
        principal: principal.trim(),
        channels,
        ttl_seconds: ttlNumber,
      });
      if (receive(ticket.ticket)) {
        setIssued((list) => [
          {
            ticket_id: ticket.ticket_id,
            principal: principal.trim(),
            channels,
            expires_at: ticket.expires_at,
          },
          ...list,
        ]);
      }
      setAttempted(false);
    } catch (err) {
      toast({ kind: 'error', title: 'Could not issue a ticket', ...explainToast(err) });
    } finally {
      setBusy(false);
    }
  };

  const revokeOne = async (target: string) => {
    if (
      !(await confirm({
        title: 'Revoke this ticket?',
        description:
          'Connections using it close within about two seconds, and reconnecting with it is refused.',
        confirmLabel: 'Revoke ticket',
        destructive: true,
      }))
    )
      return;
    try {
      await revoke.mutateAsync(target);
      setIssued((list) => list.filter((t) => t.ticket_id !== target));
      setTicketId('');
      toast({ kind: 'success', title: 'Ticket revoked' });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'not_found') {
        setIssued((list) => list.filter((t) => t.ticket_id !== target));
        toast({ kind: 'info', title: 'No live ticket with that ID — it may have expired' });
      } else toast({ kind: 'error', title: 'Could not revoke the ticket', ...explainToast(err) });
    }
  };

  const revokePrincipal = async (e: FormEvent) => {
    e.preventDefault();
    const who = logoutPrincipal.trim();
    if (!who) return;
    if (
      !(await confirm({
        title: `Revoke every ticket of ${who}?`,
        description:
          'Every unexpired ticket issued for this principal stops working, as at sign-out. Their connections close within about two seconds.',
        confirmLabel: 'Revoke tickets',
        destructive: true,
      }))
    )
      return;
    try {
      const { revoked } = await revokeAll.mutateAsync(who);
      setIssued((list) => list.filter((t) => t.principal !== who));
      setLogoutPrincipal('');
      toast({
        kind: 'success',
        title: revoked === 1 ? '1 ticket revoked' : `${revoked} tickets revoked`,
      });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not revoke tickets', ...explainToast(err) });
    }
  };

  return (
    <Section
      title="Subscription tickets"
      description="Short-lived, read-only credentials for named channels. Your backend issues them for signed-in users; issue one here to test a client."
    >
      {evidence.secret && (
        <OneTimeSecret
          key={evidence.version}
          value={evidence.secret}
          title="Subscription ticket"
          description="A bearer credential for the channels you named until it expires. Send it as Authorization: Bearer or the browser subprotocol, never in a URL."
          onDismiss={evidence.dismiss}
        />
      )}
      <form
        noValidate
        onSubmit={(e) => void issue(e)}
        aria-label="Issue a ticket"
        className="grid gap-3 sm:grid-cols-[1fr_1.5fr_7rem_auto] sm:items-start"
      >
        <TextField
          id={`${id}-principal`}
          label="Principal"
          value={principal}
          onChange={setPrincipal}
          placeholder="customer-42"
          error={shown('principal')}
        />
        <TextField
          id={`${id}-channels`}
          label={`Channels (up to ${TICKET_MAX_CHANNELS})`}
          value={channelsText}
          onChange={setChannelsText}
          placeholder="orders:tenant-42"
          error={shown('channels')}
        />
        <TextField
          id={`${id}-ttl`}
          label="Lifetime (s)"
          value={ttl}
          onChange={(v) => setTtl(v.trim())}
          error={shown('ttl')}
          inputMode="numeric"
        />
        <Button type="submit" size="sm" busy={busy} className="sm:mt-5">
          Issue ticket
        </Button>
      </form>
      {issued.length > 0 && (
        <ul className="flex flex-col divide-y divide-border well rounded-xl bg-muted/40">
          {issued.map((t) => (
            <li key={t.ticket_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
              <CopyableId value={t.ticket_id} label="ticket ID" />
              <span className="text-sm">{t.principal}</span>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {t.channels.join(', ')}
              </span>
              <span className="text-xs text-muted-foreground">
                expires <Timestamp value={t.expires_at} />
              </span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                aria-label={`Revoke ticket ${t.ticket_id}`}
                onClick={() => void revokeOne(t.ticket_id)}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (UUID.test(ticketId)) void revokeOne(ticketId);
          }}
          className="flex items-end gap-2"
          aria-label="Revoke a ticket by ID"
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Revoke by ticket ID
            <Input
              value={ticketId}
              onChange={(e) => setTicketId(e.target.value.trim().toLowerCase())}
              placeholder="ticket_id"
              className="font-mono"
            />
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={!UUID.test(ticketId)}>
            Revoke
          </Button>
        </form>
        <form
          onSubmit={(e) => void revokePrincipal(e)}
          className="flex items-end gap-2"
          aria-label="Revoke a principal's tickets"
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Revoke every ticket of a principal
            <Input
              value={logoutPrincipal}
              onChange={(e) => setLogoutPrincipal(e.target.value)}
              placeholder="customer-42"
            />
          </label>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={!logoutPrincipal.trim()}
            busy={revokeAll.isPending}
          >
            Revoke all
          </Button>
        </form>
      </div>
    </Section>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  error,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  inputMode?: 'numeric';
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function AccessSection({
  slug,
  endpointId,
  authMode,
}: {
  slug: string;
  endpointId: string;
  authMode: RealtimeAuthMode;
}) {
  const [draft, setDraft] = useState('');
  const [principal, setPrincipal] = useState('');
  return (
    <Section
      title="Principal access"
      description={
        authMode === 'oidc_jwt'
          ? 'Cut one user off without finding their sockets: deny a channel, or end every session issued before now. Changes reach every node within about two seconds.'
          : 'Access controls apply to OIDC endpoints and subscription tickets; static bearer and unauthenticated clients have no principal to revoke.'
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPrincipal(draft.trim());
        }}
        className="flex flex-wrap items-end gap-2"
        aria-label="Look up a principal"
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Principal
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="user-123" />
        </label>
        <Button type="submit" size="sm" variant="outline" disabled={!draft.trim()}>
          Look up
        </Button>
      </form>
      {principal && (
        <PrincipalAccess
          key={principal}
          slug={slug}
          endpointId={endpointId}
          principal={principal}
        />
      )}
    </Section>
  );
}

function PrincipalAccess({
  slug,
  endpointId,
  principal,
}: {
  slug: string;
  endpointId: string;
  principal: string;
}) {
  const access = useRealtimeAccess(slug, endpointId, principal);
  const change = useChangeRealtimeAccess(slug, endpointId, principal);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [channel, setChannel] = useState('');
  const [attempted, setAttempted] = useState(false);
  const phase = queryPhase({ error: access.error, loading: access.isPending });
  const error = channelError(channel);
  const data = access.data;

  const act = async (action: 'revoke_channel' | 'restore_channel' | 'revoke_sessions', ch = '') => {
    const ask =
      action === 'revoke_channel'
        ? {
            title: `Deny ${ch} to ${principal}?`,
            description: `Their subscriptions to ${ch} and its activity scopes end with an access_revoked error, and new ones are refused. Messages already delivered cannot be recalled.`,
            confirmLabel: 'Deny channel',
            destructive: true,
          }
        : action === 'restore_channel'
          ? {
              title: `Lift the deny on ${ch}?`,
              description: `${principal} may subscribe to ${ch} again if your authorize callback or channel rules still grant it. Their clients must subscribe again.`,
              confirmLabel: 'Lift deny',
            }
          : {
              title: `End every session of ${principal}?`,
              description:
                'Connections whose token was issued at or before now close, and those tokens are refused on reconnect. A token issued afterwards connects again, so a permanent ban belongs in your sign-in.',
              confirmLabel: 'End sessions',
              destructive: true,
            };
    if (!(await confirm(ask))) return;
    try {
      await change.mutateAsync({ action, channel: ch || undefined });
      if (action === 'revoke_channel') {
        setChannel('');
        setAttempted(false);
      }
      toast({ kind: 'success', title: 'Access updated' });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not change access', ...explainToast(err) });
    }
  };

  return (
    <div className="flex flex-col gap-3 well rounded-xl bg-muted/40 p-3">
      <InlinePhase
        phase={phase}
        error={access.error}
        loadingMessage="Reading access controls…"
        onRetry={() => void access.refetch()}
      />
      {data && (
        <>
          <p className="text-xs text-muted-foreground">
            {data.revision === 0 ? (
              'No access controls for this principal.'
            ) : (
              <>
                Revision {data.revision}, changed <Timestamp value={data.updated_at} />.
              </>
            )}{' '}
            Recorded is not yet applied everywhere: nodes converge within about two seconds.
          </p>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Denied channels</span>
            {data.denied_channels.length === 0 ? (
              <span className="text-xs text-muted-foreground">None.</span>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {data.denied_channels.map((ch) => (
                  <li
                    key={ch}
                    className="flex items-center gap-1.5 rounded-full bg-muted py-0.5 pl-2 pr-1"
                  >
                    <StatusTag tone="critical" label="Denied" />
                    <span className="font-mono text-xs">{ch}</span>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => void act('restore_channel', ch)}
                    >
                      Lift
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-xs">
            <span className="font-medium">Sessions ended before: </span>
            {data.sessions_revoked_before ? (
              <Timestamp value={data.sessions_revoked_before} mode="absolute" />
            ) : (
              <span className="text-muted-foreground">never</span>
            )}
          </p>
        </>
      )}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setAttempted(true);
          if (!error) void act('revoke_channel', channel);
        }}
        className="flex flex-wrap items-end gap-2"
        aria-label="Deny a channel"
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Deny a channel
          <Input
            value={channel}
            onChange={(e) => setChannel(e.target.value.trim())}
            placeholder="project-42"
            aria-invalid={attempted && error ? true : undefined}
          />
        </label>
        <Button type="submit" size="sm" variant="outline" busy={change.isPending}>
          Deny…
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void act('revoke_sessions')}
        >
          End sessions…
        </Button>
        {attempted && error && (
          <p role="alert" className="w-full text-xs text-destructive">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

const PROVIDER_LABEL = { fcm: 'Firebase Cloud Messaging', apns: 'Apple Push', webpush: 'Web Push' };

export function PushSection({ slug, endpointId }: { slug: string; endpointId: string }) {
  const providers = useRealtimePushProviders(slug, endpointId);
  const list = providers.data ?? [];
  const phase = queryPhase({
    error: providers.error,
    loading: providers.isPending,
    isEmpty: list.length === 0,
  });
  return (
    <Section
      title="Push providers"
      description="Where principal notifications fall back to when the user is offline. Credentials are never returned."
    >
      <InlinePhase
        phase={phase}
        error={providers.error}
        loadingMessage="Reading push providers…"
        emptyMessage="No push provider is configured for this endpoint."
        onRetry={() => void providers.refetch()}
      />
      {phase === 'ready' && (
        <ul className="flex flex-col divide-y divide-border well rounded-xl bg-muted/40">
          {list.map((p) => (
            <li key={p.provider} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
              <span className="text-sm">{PROVIDER_LABEL[p.provider]}</span>
              <StatusTag
                tone={p.enabled ? 'good' : 'muted'}
                label={p.enabled ? 'Enabled' : 'Disabled'}
              />
              <span className="text-xs text-muted-foreground">
                updated <Timestamp value={p.updated_at} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
