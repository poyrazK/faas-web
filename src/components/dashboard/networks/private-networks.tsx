import { useState, type ReactNode } from 'react';
import { Plus, Trash, Xmark } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { FIELD, Select } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import {
  EmptyState,
  ErrorState,
  InlinePhase,
  LoadingState,
  PageHeader,
  Panel,
  UnreachableState,
  queryPhase,
} from '../primitives';
import { useAuth } from '@/lib/auth';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import {
  NETWORK_ID,
  isCidr,
  isPortSpec,
  parseCidrs,
  useCreateNetwork,
  useCreatePeering,
  useDeleteNetwork,
  useDeletePeering,
  useNetworkMembers,
  useNetworkPeerings,
  useNetworks,
  useUpdateNetworkPolicy,
  type FirewallRule,
  type PrivateNetwork,
} from '@/lib/api/networks';
import {
  CidrListField,
  NetworkStatus,
  cidrsValid,
  isNotEnabled,
  networkFailure,
} from './network-shared';

/**
 * The account's private networks (faas docs/private-networks.md): create and
 * delete networks, read their member addresses and capacity, peer two of them,
 * and replace the reusable firewall policy every attached app inherits.
 *
 * `/v1/networks` is the signed-in account's (handlers_private_networks.go
 * keys every read by `acct.ID`; there is no organization route), so a company
 * workspace says so and reads nothing rather than showing personal networks
 * under the company's name.
 */
export function PrivateNetworksBody({
  selected,
  onSelect,
}: {
  selected?: string;
  onSelect: (id?: string) => void;
}) {
  const { org, label } = useWorkspaceTarget();
  const { account } = useAuth();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Private networks"
        description="Private IPv4 ranges for your apps. Attach an app on its Private network tab; only ready networks, peerings and attachments carry traffic."
      />
      {org ? (
        <Panel title="Private networks">
          <p role="status" className="text-sm text-muted-foreground">
            Private networks belong to an account, not to {label}: the API lists only the signed-in
            account&apos;s networks. Switch to your personal workspace to manage them.
          </p>
        </Panel>
      ) : (
        account && <Networks accountId={account.id} selected={selected} onSelect={onSelect} />
      )}
    </div>
  );
}

function policyLine(network: PrivateNetwork) {
  const cidrs = network.allowed_cidrs?.length ?? 0;
  const rules = network.firewall_rules?.length ?? 0;
  if (!cidrs && !rules) return 'Policy: no restriction inside the network';
  return `Policy: ${cidrs} allowed range${cidrs === 1 ? '' : 's'}, ${rules} firewall rule${rules === 1 ? '' : 's'}`;
}

function Networks({
  accountId,
  selected,
  onSelect,
}: {
  accountId: string;
  selected?: string;
  onSelect: (id?: string) => void;
}) {
  const list = useNetworks(accountId);
  const networks = list.data?.networks ?? [];
  if (isNotEnabled(list.error))
    return (
      <Panel title="Private networks">
        <p role="status" className="text-sm text-muted-foreground">
          Private networking is not enabled on this installation. Contact support for availability.
        </p>
      </Panel>
    );
  const phase = queryPhase({
    error: list.error,
    loading: list.isPending,
    isEmpty: networks.length === 0,
  });
  const current = selected ? networks.find((n) => n.id === selected) : undefined;
  return (
    <>
      <Panel title="Networks" padded={phase !== 'ready'}>
        {phase === 'unreachable' ? (
          <UnreachableState onRetry={() => void list.refetch()} />
        ) : phase === 'error' ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : phase === 'loading' ? (
          <LoadingState message="Loading private networks…" />
        ) : phase === 'empty' ? (
          <EmptyState message="No private networks yet. Create one below." />
        ) : (
          <ul className="divide-y divide-border">
            {networks.map((network) => (
              <li key={network.id}>
                <button
                  type="button"
                  aria-current={network.id === selected ? 'true' : undefined}
                  onClick={() => onSelect(network.id === selected ? undefined : network.id)}
                  className="pressable flex w-full flex-col gap-1 px-5 py-3.5 text-left hover:bg-accent/40 aria-[current=true]:bg-accent/60"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{network.name}</span>
                    <NetworkStatus status={network.status} />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <span className="font-mono">{network.cidr}</span> · region {network.region} ·{' '}
                    {policyLine(network)}
                  </span>
                  {network.status === 'error' && network.status_detail && (
                    <span className="text-xs" style={{ color: 'var(--status-critical)' }}>
                      {network.status_detail}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {selected && phase === 'ready' && !current && (
        <Panel title="Network">
          <p role="alert" className="text-sm text-muted-foreground">
            No network <span className="font-mono">{selected}</span> in this account.{' '}
            <button
              type="button"
              className="text-brand underline"
              onClick={() => onSelect(undefined)}
            >
              Close
            </button>
          </p>
        </Panel>
      )}
      {current && (
        <NetworkDetail
          key={current.id}
          accountId={accountId}
          network={current}
          networks={networks}
          onClose={() => onSelect(undefined)}
        />
      )}
      <CreateNetwork accountId={accountId} onCreated={onSelect} />
    </>
  );
}

function CreateNetwork({
  accountId,
  onCreated,
}: {
  accountId: string;
  onCreated: (id: string) => void;
}) {
  const { toast } = useToast();
  const create = useCreateNetwork(accountId);
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [cidr, setCidr] = useState('');
  const [allowed, setAllowed] = useState('');
  const nameOk = NETWORK_ID.test(name);
  const regionOk = NETWORK_ID.test(region);
  const cidrOk = isCidr(cidr);
  const submit = async () => {
    try {
      const created = await create.mutateAsync({
        body: {
          name,
          region,
          cidr: cidr.trim(),
          ...(parseCidrs(allowed).length ? { allowed_cidrs: parseCidrs(allowed) } : {}),
        },
      });
      toast({ kind: 'success', title: `Created ${created.name}` });
      setName('');
      setCidr('');
      setAllowed('');
      onCreated(created.id);
    } catch (err) {
      toast(
        networkFailure(
          err,
          'Could not create the network',
          'A network with this name, or an overlapping range in this region, already exists.'
        )
      );
    }
  };
  return (
    <Panel
      title="Create a network"
      description="An IPv4 RFC 1918 range from /16 to /28. The region is a Gregale placement label."
    >
      <form
        className="grid gap-4 sm:max-w-xl sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm">
          Name
          <input
            className={`${FIELD} font-mono`}
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase())}
            placeholder="prod-net"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          Region
          <input
            className={`${FIELD} font-mono`}
            value={region}
            onChange={(e) => setRegion(e.target.value.toLowerCase())}
            placeholder="fra1"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          Range
          <input
            className={`${FIELD} font-mono`}
            value={cidr}
            onChange={(e) => setCidr(e.target.value)}
            placeholder="10.42.0.0/16"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <div className="sm:col-span-2">
          <CidrListField
            label="Allowed ranges (optional)"
            hint="Ranges inside the network that attached apps may reach. Empty allows the whole network."
            value={allowed}
            onChange={setAllowed}
          />
        </div>
        <div className="sm:col-span-2">
          <Button
            type="submit"
            disabled={!nameOk || !regionOk || !cidrOk || !cidrsValid(allowed) || create.isPending}
          >
            <Plus aria-hidden />
            Create network
          </Button>
          {(name || region) && (!nameOk || !regionOk) && (
            <p className="mt-2 text-xs text-muted-foreground">
              Names and regions start with a letter and use lowercase letters, digits and dashes.
            </p>
          )}
        </div>
      </form>
    </Panel>
  );
}

function NetworkDetail({
  accountId,
  network,
  networks,
  onClose,
}: {
  accountId: string;
  network: PrivateNetwork;
  networks: PrivateNetwork[];
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const remove = useDeleteNetwork(accountId);
  const onDelete = async () => {
    if (
      !(await confirm({
        title: `Delete ${network.name}?`,
        description: `The range ${network.cidr} and its policy are deleted. The API refuses while an app is attached or a peering names it.`,
        confirmLabel: 'Delete network',
        destructive: true,
        typeToConfirm: network.name,
      }))
    )
      return;
    try {
      await remove.mutateAsync(network.id);
      toast({ kind: 'success', title: `Deleted ${network.name}` });
      onClose();
    } catch (err) {
      toast(
        networkFailure(
          err,
          'Could not delete the network',
          'An app is still attached, or a peering names this network. Detach the apps and remove the peerings first.'
        )
      );
    }
  };
  return (
    <Panel
      title={network.name}
      description={`${network.cidr} · region ${network.region}`}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void onDelete()}
            disabled={remove.isPending}
          >
            <Trash aria-hidden />
            Delete network
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close network">
            <Xmark aria-hidden />
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Network ID</dt>
            <dd>
              <CopyableId value={network.id} label="network ID" full />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd className="flex flex-col items-start gap-1">
              <NetworkStatus status={network.status} />
              {network.status_detail && (
                <span className="text-xs text-muted-foreground">{network.status_detail}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Created</dt>
            <dd>
              <Timestamp value={network.created_at} />
            </dd>
          </div>
        </dl>
        <Members accountId={accountId} id={network.id} />
        <Peerings accountId={accountId} network={network} networks={networks} />
        <PolicyEditor accountId={accountId} network={network} />
      </div>
    </Panel>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4">
      <h3 className="label-mono text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Members({ accountId, id }: { accountId: string; id: string }) {
  const read = useNetworkMembers(accountId, id);
  const phase = queryPhase({ error: read.error, loading: read.isPending });
  return (
    <Section title="Members">
      <InlinePhase
        phase={phase}
        error={read.error}
        loadingMessage="Reading member addresses…"
        onRetry={() => void read.refetch()}
      />
      {phase === 'ready' && read.data && (
        <>
          <p className="text-sm">
            {read.data.used} of {read.data.capacity} addresses in use · {read.data.available}{' '}
            available
          </p>
          {read.data.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No app holds an address yet.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {read.data.members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono">{m.address}</span>
                  <span className="text-xs text-muted-foreground">{m.owner_type}</span>
                  <CopyableId value={m.owner_id} label={`${m.owner_type} ID`} />
                  {m.created_at && (
                    <span className="text-xs text-muted-foreground">
                      since <Timestamp value={m.created_at} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Inventory only: an address is reserved, not proof the app is reachable. The network,
            gateway and broadcast addresses are not counted.
          </p>
        </>
      )}
    </Section>
  );
}

function Peerings({
  accountId,
  network,
  networks,
}: {
  accountId: string;
  network: PrivateNetwork;
  networks: PrivateNetwork[];
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const read = useNetworkPeerings(accountId, network.id);
  const create = useCreatePeering(accountId, network.id);
  const remove = useDeletePeering(accountId, network.id);
  const peerings = read.data?.peerings ?? [];
  const phase = queryPhase({
    error: read.error,
    loading: read.isPending,
    isEmpty: peerings.length === 0,
  });
  const nameOf = (id: string) => networks.find((n) => n.id === id)?.name ?? id;
  const candidates = networks.filter(
    (n) =>
      n.id !== network.id &&
      n.region === network.region &&
      !peerings.some((p) => p.peer_network_id === n.id)
  );
  const [peer, setPeer] = useState('');
  const chosen = candidates.find((n) => n.id === peer) ?? candidates[0];

  const onPeer = async () => {
    if (!chosen) return;
    if (
      !(await confirm({
        title: `Peer ${network.name} with ${chosen.name}?`,
        description: `Once the peering is ready, apps on either network can reach the other's range (${network.cidr} and ${chosen.cidr}), within each network's policy. It stays pending, and carries nothing, until the fabric converges.`,
        confirmLabel: 'Request peering',
      }))
    )
      return;
    try {
      await create.mutateAsync({ peer: chosen.id });
      toast({ kind: 'success', title: 'Peering requested', description: 'It is pending.' });
    } catch (err) {
      toast(
        networkFailure(err, 'Could not peer the networks', 'The two networks are already peered.')
      );
    }
  };
  const onRemove = async (id: string, peerId: string) => {
    if (
      !(await confirm({
        title: `Remove the peering with ${nameOf(peerId)}?`,
        description: `Routes between ${network.name} and ${nameOf(peerId)} are withdrawn: apps on one can no longer reach the other.`,
        confirmLabel: 'Remove peering',
        destructive: true,
      }))
    )
      return;
    try {
      await remove.mutateAsync({ peering: id });
      toast({ kind: 'success', title: 'Peering removed' });
    } catch (err) {
      toast(networkFailure(err, 'Could not remove the peering'));
    }
  };

  return (
    <Section title="Peerings">
      <InlinePhase
        phase={phase}
        error={read.error}
        loadingMessage="Reading peerings…"
        emptyMessage="Not peered with another network."
        onRetry={() => void read.refetch()}
      />
      {phase === 'ready' && (
        <ul className="flex flex-col gap-2 text-sm">
          {peerings.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono">{nameOf(p.peer_network_id)}</span>
              <NetworkStatus status={p.status} />
              {p.status_detail && (
                <span className="text-xs text-muted-foreground">{p.status_detail}</span>
              )}
              <Button
                size="xs"
                variant="ghost"
                disabled={remove.isPending}
                onClick={() => void onRemove(p.id, p.peer_network_id)}
                aria-label={`Remove peering with ${nameOf(p.peer_network_id)}`}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {candidates.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-48 flex-col gap-1.5 text-sm">
            Peer with
            <Select value={chosen?.id ?? ''} onChange={(e) => setPeer(e.target.value)}>
              {candidates.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.cidr})
                </option>
              ))}
            </Select>
          </label>
          <Button variant="outline" disabled={create.isPending} onClick={() => void onPeer()}>
            Request peering
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Peering needs another network of yours in region {network.region}, with a range that does
          not overlap this one.
        </p>
      )}
    </Section>
  );
}

type RuleDraft = {
  direction: FirewallRule['direction'];
  protocol: FirewallRule['protocol'];
  cidrs: string;
  ports: string;
};

const toDraft = (rule: FirewallRule): RuleDraft => ({
  direction: rule.direction,
  protocol: rule.protocol,
  cidrs: (rule.cidrs ?? []).join(', '),
  ports: (rule.ports ?? []).join(', '),
});

/** TCP and UDP rules name ports or ranges; ICMP has none. */
function portsValid(rule: RuleDraft) {
  const ports = parseCidrs(rule.ports);
  return rule.protocol === 'icmp'
    ? ports.length === 0
    : ports.length > 0 && ports.every(isPortSpec);
}

const ruleValid = (rule: RuleDraft) => cidrsValid(rule.cidrs) && portsValid(rule);

function PolicyEditor({ accountId, network }: { accountId: string; network: PrivateNetwork }) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const update = useUpdateNetworkPolicy(accountId, network.id);
  const [allowed, setAllowed] = useState((network.allowed_cidrs ?? []).join('\n'));
  const [rules, setRules] = useState<RuleDraft[]>((network.firewall_rules ?? []).map(toDraft));
  const valid = cidrsValid(allowed) && rules.every(ruleValid);
  const patch = (index: number, next: Partial<RuleDraft>) =>
    setRules((current) => current.map((r, i) => (i === index ? { ...r, ...next } : r)));

  const save = async () => {
    const allowedCidrs = parseCidrs(allowed);
    if (
      !(await confirm({
        title: `Replace the policy of ${network.name}?`,
        description: `Both lists are replaced as shown and applied to every app attached to ${network.name}: ${allowedCidrs.length || 'no'} allowed range${allowedCidrs.length === 1 ? '' : 's'} and ${rules.length || 'no'} firewall rule${rules.length === 1 ? '' : 's'}. Each node applies it in turn, and traffic outside a non-empty list is blocked. An empty list removes that restriction.`,
        confirmLabel: 'Replace policy',
      }))
    )
      return;
    try {
      await update.mutateAsync({
        allowed_cidrs: allowedCidrs,
        firewall_rules: rules.map((r) => ({
          direction: r.direction,
          protocol: r.protocol,
          ...(parseCidrs(r.cidrs).length ? { cidrs: parseCidrs(r.cidrs) } : {}),
          ...(r.protocol !== 'icmp' ? { ports: parseCidrs(r.ports) } : {}),
        })),
      });
      toast({ kind: 'success', title: 'Policy replaced' });
    } catch (err) {
      toast(networkFailure(err, 'Could not replace the policy'));
    }
  };

  return (
    <Section title="Policy">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="sm:max-w-xl">
          <CidrListField
            label="Allowed ranges"
            hint={`Inside ${network.cidr}. Empty allows the whole network.`}
            value={allowed}
            onChange={setAllowed}
          />
        </div>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm">Firewall rules</legend>
          {rules.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No rules: every protocol and port inside the allowed ranges.
            </p>
          )}
          {rules.map((rule, index) => (
            <div
              key={index}
              role="group"
              aria-label={`Rule ${index + 1}`}
              className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[8rem_7rem_1fr_1fr_auto] sm:items-end"
            >
              <label className="flex flex-col gap-1.5 text-xs">
                Direction
                <Select
                  value={rule.direction}
                  onChange={(e) =>
                    patch(index, { direction: e.target.value as RuleDraft['direction'] })
                  }
                >
                  <option value="ingress">Ingress</option>
                  <option value="egress">Egress</option>
                </Select>
              </label>
              <label className="flex flex-col gap-1.5 text-xs">
                Protocol
                <Select
                  value={rule.protocol}
                  onChange={(e) =>
                    patch(index, {
                      protocol: e.target.value as RuleDraft['protocol'],
                      ...(e.target.value === 'icmp' ? { ports: '' } : {}),
                    })
                  }
                >
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                  <option value="icmp">ICMP</option>
                </Select>
              </label>
              <label className="flex flex-col gap-1.5 text-xs">
                {rule.direction === 'ingress' ? 'From' : 'To'} (empty: the network)
                <input
                  className={`${FIELD} font-mono`}
                  value={rule.cidrs}
                  onChange={(e) => patch(index, { cidrs: e.target.value })}
                  placeholder={network.cidr}
                  spellCheck={false}
                  aria-invalid={cidrsValid(rule.cidrs) ? undefined : true}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs">
                Ports
                <input
                  className={`${FIELD} font-mono`}
                  value={rule.ports}
                  onChange={(e) => patch(index, { ports: e.target.value })}
                  placeholder={rule.protocol === 'icmp' ? 'none for ICMP' : '443, 8000-8080'}
                  disabled={rule.protocol === 'icmp'}
                  spellCheck={false}
                  aria-invalid={portsValid(rule) ? undefined : true}
                />
              </label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Remove rule ${index + 1}`}
                onClick={() => setRules((current) => current.filter((_, i) => i !== index))}
              >
                <Trash aria-hidden />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={rules.length >= 64}
              onClick={() =>
                setRules((current) => [
                  ...current,
                  { direction: 'ingress', protocol: 'tcp', cidrs: '', ports: '' },
                ])
              }
            >
              <Plus aria-hidden />
              Add rule
            </Button>
          </div>
        </fieldset>
        <div>
          <Button type="submit" disabled={!valid || update.isPending}>
            Replace policy
          </Button>
        </div>
      </form>
    </Section>
  );
}
