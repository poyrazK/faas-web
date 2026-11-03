import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, Select } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { CapabilityGate } from '../capability-gate';
import {
  ErrorState,
  InlinePhase,
  LoadingState,
  Panel,
  UnreachableState,
  queryPhase,
} from '../primitives';
import { useAuth } from '@/lib/auth';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import {
  NETWORK_ID,
  parseCidrs,
  useAppNetworkAttachment,
  useAttachNetwork,
  useDetachNetwork,
  useNetworks,
  type AppNetworkAttachment,
} from '@/lib/api/networks';
import {
  CidrListField,
  NetworkStatus,
  cidrsValid,
  isNotEnabled,
  networkFailure,
} from './network-shared';

/**
 * The app's private-network attachment (`/v1/apps/{slug}/network/private`,
 * faas handlers_apps_private_network.go). One attachment per app; every write
 * is accepted as `pending` and only `ready` admits private traffic, so the
 * status is what this panel leads with, with each node's last convergence
 * result beneath it.
 */
export function AppPrivateNetwork({ slug }: { slug: string }) {
  return (
    <CapabilityGate capability="private-networks" title="Private network">
      <AttachmentBody slug={slug} />
    </CapabilityGate>
  );
}

type Attachment = NonNullable<AppNetworkAttachment['attachment']>;

function AttachmentBody({ slug }: { slug: string }) {
  const read = useAppNetworkAttachment(slug);
  const [editing, setEditing] = useState(false);
  if (isNotEnabled(read.error))
    return (
      <Panel title="Private network">
        <p role="status" className="text-sm text-muted-foreground">
          Private network attachments are not enabled on this installation. Contact support for
          availability.
        </p>
      </Panel>
    );
  const phase = queryPhase({ error: read.error, loading: read.isPending });
  const data = read.data;
  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Private network"
        description="Attach this app to one private network. Traffic flows only once the attachment is ready; pending and error keep it blocked."
      >
        {phase === 'unreachable' ? (
          <UnreachableState onRetry={() => void read.refetch()} />
        ) : phase === 'error' ? (
          <ErrorState error={read.error} onRetry={() => void read.refetch()} />
        ) : phase === 'loading' || !data ? (
          <LoadingState message="Reading the attachment…" />
        ) : !data.attachment ? (
          <p className="text-sm text-muted-foreground">Not attached to a private network.</p>
        ) : (
          <AttachmentView
            slug={slug}
            attachment={data.attachment}
            onEdit={() => setEditing(true)}
            onRefresh={() => void read.refetch()}
            refreshing={read.isFetching}
          />
        )}
      </Panel>
      {data &&
        (data.plan_allowed ? (
          (!data.attachment || editing) && (
            <AttachForm
              key={data.attachment?.id ?? 'new'}
              slug={slug}
              current={data.attachment ?? undefined}
              maxCidrs={data.max_cidrs}
              onDone={() => setEditing(false)}
            />
          )
        ) : (
          <Panel title="Attach">
            <p role="status" className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              Private networks are on the Pro and Scale plans.
              <Link to="/dashboard/plans" className="text-brand underline">
                View plans
              </Link>
            </p>
          </Panel>
        ))}
    </div>
  );
}

function AttachmentView({
  slug,
  attachment,
  onEdit,
  onRefresh,
  refreshing,
}: {
  slug: string;
  attachment: Attachment;
  onEdit: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const detach = useDetachNetwork(slug);
  const onDetach = async () => {
    if (
      !(await confirm({
        title: `Detach ${slug} from ${attachment.network_id}?`,
        description: `Private traffic between ${slug} and ${attachment.network_id} stops, and the app's address in the network is released.`,
        confirmLabel: 'Detach',
        destructive: true,
      }))
    )
      return;
    try {
      await detach.mutateAsync();
      toast({ kind: 'success', title: 'Detached' });
    } catch (err) {
      toast(networkFailure(err, 'Could not detach'));
    }
  };
  const allowed = attachment.allowed_cidrs ?? [];
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono">{attachment.network_id}</span>
        <NetworkStatus status={attachment.status} />
        <span className="text-xs text-muted-foreground">region {attachment.region}</span>
      </div>
      {attachment.status_detail && (
        <p className="text-xs text-muted-foreground">{attachment.status_detail}</p>
      )}
      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">App address</dt>
          <dd className="font-mono">{attachment.address ?? 'Not assigned'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Routed ranges</dt>
          <dd className="font-mono">{attachment.cidrs.join(', ')}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Allowed ranges</dt>
          <dd className={allowed.length ? 'font-mono' : 'text-muted-foreground'}>
            {allowed.length ? allowed.join(', ') : 'No restriction'}
          </dd>
        </div>
      </dl>
      {attachment.nodes && attachment.nodes.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="label-mono text-foreground">Nodes</h3>
          <ul className="flex flex-col gap-2" aria-label="Convergence by node">
            {attachment.nodes.map((node) => (
              <li
                key={node.node_id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2"
              >
                <span className="font-mono text-xs">{node.node_id}</span>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  fabric {node.fabric_status ? <NetworkStatus status={node.fabric_status} /> : '—'}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  routes {node.route_status ? <NetworkStatus status={node.route_status} /> : '—'}
                </span>
                {(node.fabric_detail || node.route_detail) && (
                  <span className="text-xs text-muted-foreground">
                    {[node.fabric_detail, node.route_detail].filter(Boolean).join(' · ')}
                  </span>
                )}
                {node.observed_at && (
                  <span className="text-xs text-muted-foreground">
                    <Timestamp value={node.observed_at} />
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Each node&apos;s last reconciliation; the next one replaces it.
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={refreshing}>
          Refresh
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit}>
          Change attachment
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void onDetach()}
          disabled={detach.isPending}
        >
          <Trash aria-hidden />
          Detach
        </Button>
      </div>
    </div>
  );
}

const OTHER = '__other__';

function AttachForm({
  slug,
  current,
  maxCidrs,
  onDone,
}: {
  slug: string;
  current?: Attachment;
  maxCidrs: number;
  onDone: () => void;
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const { account } = useAuth();
  const { org } = useWorkspaceTarget();
  // Networks are the signed-in account's; in a company workspace the app's
  // owner may be someone else, so the ID is typed rather than picked.
  const networks = useNetworks(account?.id ?? '', !org);
  const owned = org ? [] : (networks.data?.networks ?? []);
  const attach = useAttachNetwork(slug);
  const [choice, setChoice] = useState(current?.network_id ?? '');
  const [typed, setTyped] = useState(current?.network_id ?? '');
  const [region, setRegion] = useState('');
  const [cidrs, setCidrs] = useState('');
  const [allowed, setAllowed] = useState((current?.allowed_cidrs ?? []).join('\n'));
  const listed = owned.find((n) => n.id === choice);
  const other = org || choice === OTHER || (!listed && Boolean(choice));
  const networkId = other ? typed.trim() : (listed?.id ?? '');
  const destinations = parseCidrs(cidrs);
  const valid =
    NETWORK_ID.test(networkId) &&
    (!region || NETWORK_ID.test(region)) &&
    cidrsValid(cidrs) &&
    destinations.length <= maxCidrs &&
    cidrsValid(allowed);
  const phase = queryPhase({ error: networks.error, loading: !org && networks.isPending });

  const submit = async () => {
    if (
      !(await confirm({
        title: `Attach ${slug} to ${networkId}?`,
        description: `The request is accepted as pending: private traffic stays blocked until the attachment is ready.${current ? ` It replaces the attachment to ${current.network_id}.` : ''}${parseCidrs(allowed).length ? ' Private traffic is limited to the allowed ranges, both ways.' : ''}`,
        confirmLabel: 'Attach',
      }))
    )
      return;
    try {
      await attach.mutateAsync({
        network_id: networkId,
        ...(region ? { region } : {}),
        ...(destinations.length ? { cidrs: destinations } : {}),
        allowed_cidrs: parseCidrs(allowed),
      });
      toast({ kind: 'success', title: 'Attachment requested', description: 'It is pending.' });
      onDone();
    } catch (err) {
      toast(networkFailure(err, 'Could not attach', 'No address is free in this network.'));
    }
  };

  return (
    <Panel title={current ? 'Change attachment' : 'Attach to a network'}>
      <form
        className="flex flex-col gap-4 sm:max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {!org && phase !== 'ready' ? (
          <InlinePhase
            phase={phase}
            error={networks.error}
            loadingMessage="Loading your networks…"
            onRetry={() => void networks.refetch()}
          />
        ) : (
          !org && (
            <label className="flex flex-col gap-1.5 text-sm">
              Network
              <Select value={choice} onChange={(e) => setChoice(e.target.value)}>
                <option value="">Choose a network</option>
                {owned.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.cidr}, {n.region})
                  </option>
                ))}
                <option value={OTHER}>Another network ID…</option>
              </Select>
              {owned.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  You have no networks yet.{' '}
                  <Link to="/dashboard/networks" className="text-brand underline">
                    Create one
                  </Link>
                </span>
              )}
            </label>
          )
        )}
        {other && (
          <label className="flex flex-col gap-1.5 text-sm">
            Network ID
            <input
              className={`${FIELD} font-mono`}
              value={typed}
              onChange={(e) => setTyped(e.target.value.toLowerCase())}
              placeholder="prod-vpc"
              spellCheck={false}
              autoComplete="off"
            />
            <span className="text-xs text-muted-foreground">
              {org
                ? "A network of the app's account. Networks are listed in the personal workspace."
                : 'A network your installation connects outside Gregale.'}
            </span>
          </label>
        )}
        <label className="flex flex-col gap-1.5 text-sm">
          Region (optional)
          <input
            className={`${FIELD} font-mono`}
            value={region}
            onChange={(e) => setRegion(e.target.value.toLowerCase())}
            placeholder="fra1"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="text-xs text-muted-foreground">
            Leave empty for a Gregale network: it is the network&apos;s own region.
          </span>
        </label>
        <CidrListField
          label="Routed ranges (optional)"
          placeholder="10.20.0.0/16"
          hint={`Leave empty for a Gregale network: it routes the network's range. An external network takes up to ${maxCidrs} non-overlapping RFC 1918 ranges.`}
          value={cidrs}
          onChange={setCidrs}
        />
        <CidrListField
          label="Allowed ranges (optional)"
          hint="Restrict private traffic both ways to these ranges, inside the network. Empty allows the whole network, within its own policy."
          value={allowed}
          onChange={setAllowed}
        />
        <div className="flex gap-2">
          <Button type="submit" disabled={!valid || attach.isPending}>
            {current ? 'Change attachment' : 'Attach'}
          </Button>
          {current && (
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Panel>
  );
}
