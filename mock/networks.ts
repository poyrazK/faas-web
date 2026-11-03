import type { components } from '../src/lib/api/schema';
import { EMPTY, account, appBySlug, apps, iso } from './data';

/**
 * Dev-mock answers for private networks (faas handlers_private_networks.go)
 * and an app's private-network attachment (handlers_apps_private_network.go).
 *
 * Seeded: two peered networks in fra1 and one in ams3 whose host bridge
 * failed, and the first app attached to `prod-net` with one node converged
 * and one whose routes failed. There is no fabric here, so a new peering or
 * attachment stays `pending`, which is also what the API answers first.
 *
 * `MOCK_PLAN=free|hobby` shows the plan refusal (402
 * plan_private_network_not_allowed) and `MOCK_PRIVATE_NETWORKS=off` the
 * installation without the fabric (503 private_network_not_enabled).
 */

type S = components['schemas'];
interface MockCtx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
}
type Register = (method: string, template: string, handler: (ctx: MockCtx) => unknown) => void;
type ProblemCtor = new (status: number, code: string, detail?: string) => Error;

type Network = S['PrivateNetwork'];
type Attachment = S['AppPrivateNetworkAttachment'];
interface Member {
  id: string;
  owner_type: string;
  owner_id: string;
  address: string;
  created_at: string;
  network_id: string;
}
interface Peering {
  id: string;
  left: string;
  right: string;
  region: string;
  status: S['PrivateNetworkPeering']['status'];
  status_detail?: string;
  created_at: string;
  updated_at: string;
}

const DAY = 86_400_000;
const ID = /^[a-z][a-z0-9-]{0,62}$/;
const status = (code: number, body: unknown) => ({ __status: code, body });

const networks: Network[] = [];
const peerings: Peering[] = [];
const members: Member[] = [];
const attachments = new Map<string, Attachment>();

function seed() {
  networks.push(
    {
      id: 'prod-net',
      name: 'prod-net',
      region: 'fra1',
      cidr: '10.42.0.0/16',
      allowed_cidrs: ['10.42.8.0/24'],
      firewall_rules: [{ direction: 'ingress', protocol: 'tcp', ports: ['5432', '6379'] }],
      status: 'ready',
      created_at: iso(30 * DAY),
      updated_at: iso(3 * DAY),
    },
    {
      id: 'data-net',
      name: 'data-net',
      region: 'fra1',
      cidr: '10.43.0.0/16',
      status: 'ready',
      created_at: iso(20 * DAY),
      updated_at: iso(20 * DAY),
    },
    {
      id: 'lab-net',
      name: 'lab-net',
      region: 'ams3',
      cidr: '10.50.0.0/24',
      status: 'error',
      status_detail: 'host bridge reconciliation failed on node-ams3-2',
      created_at: iso(4 * DAY),
      updated_at: iso(DAY),
    }
  );
  peerings.push({
    id: 'peer-prod-data',
    left: 'prod-net',
    right: 'data-net',
    region: 'fra1',
    status: 'ready',
    created_at: iso(10 * DAY),
    updated_at: iso(10 * DAY),
  });
  const app = apps[0];
  if (!app) return;
  members.push({
    id: crypto.randomUUID(),
    owner_type: 'app',
    owner_id: app.id,
    address: '10.42.0.2',
    created_at: iso(9 * DAY),
    network_id: 'prod-net',
  });
  attachments.set(app.slug, {
    id: crypto.randomUUID(),
    network_id: 'prod-net',
    region: 'fra1',
    cidrs: ['10.42.0.0/16'],
    allowed_cidrs: ['10.42.8.0/24'],
    address: '10.42.0.2',
    status: 'error',
    status_detail: 'route policy failed on 1 of 2 nodes',
    nodes: [
      {
        node_id: 'node-fra1-1',
        fabric_status: 'ready',
        route_status: 'ready',
        observed_at: iso(60_000),
      },
      {
        node_id: 'node-fra1-2',
        fabric_status: 'ready',
        route_status: 'error',
        route_detail: 'nft apply failed: table busy',
        observed_at: iso(90_000),
      },
    ],
    created_at: iso(9 * DAY),
    updated_at: iso(60_000),
  });
}

const PREFIX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;
function prefix(value: unknown): { base: number; bits: number } | undefined {
  const m = PREFIX.exec(String(value ?? '').trim());
  if (!m) return;
  const o = m.slice(1, 5).map(Number);
  const bits = Number(m[5]);
  if (o.some((x) => x > 255) || bits > 32) return;
  const base = ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
  return { base, bits };
}
const mask = (bits: number) => (bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0);
const contains = (outer: string, inner: string) => {
  const a = prefix(outer);
  const b = prefix(inner);
  return Boolean(a && b && b.bits >= a.bits && (b.base & mask(a.bits)) === (a.base & mask(a.bits)));
};
const overlaps = (x: string, y: string) => contains(x, y) || contains(y, x);
const rfc1918 = (cidr: string) =>
  ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'].some((r) => contains(r, cidr));

export function registerNetworkMocks(route: Register, Problem: ProblemCtor, NO_CONTENT: symbol) {
  if (!EMPTY) seed();

  const plan = () => process.env.MOCK_PLAN ?? account.plan;
  const planAllowed = () => plan() === 'pro' || plan() === 'scale';
  const enabled = () => {
    if (process.env.MOCK_PRIVATE_NETWORKS === 'off')
      throw new Problem(
        503,
        'private_network_not_enabled',
        'private network attachments are not available on this Gregale installation right now; contact support for availability'
      );
  };
  const requirePlan = () => {
    if (!planAllowed())
      throw new Problem(
        402,
        'plan_private_network_not_allowed',
        `plan "${plan()}" does not unlock private network attachments; upgrade to Pro or Scale.`
      );
  };
  const invalid = (field: string, value: string, reason: string) =>
    new Problem(400, 'private_network_invalid', `${field}="${value}" is not accepted: ${reason}.`);
  const network = (raw: string) => {
    const hit = networks.find((n) => n.id === raw);
    if (!hit) throw new Problem(404, 'not_found', 'the requested network does not exist');
    return hit;
  };
  const policy = (cidr: string, allowed: unknown, rules: unknown) => {
    const list = Array.isArray(allowed) ? allowed.map(String) : [];
    for (const c of list)
      if (!contains(cidr, c)) throw invalid('allowed_cidrs', c, 'must be inside the network CIDR');
    const ruleList = (Array.isArray(rules) ? rules : []) as S['PrivateNetworkFirewallRule'][];
    for (const [i, r] of ruleList.entries()) {
      if (r.protocol === 'icmp' && r.ports?.length)
        throw invalid('firewall_rules', '', `rule ${i} icmp cannot specify ports`);
      if (r.protocol !== 'icmp' && !r.ports?.length)
        throw invalid(
          'firewall_rules',
          '',
          `rule ${i} ${r.protocol} requires at least one port or range`
        );
    }
    return { allowed_cidrs: list, firewall_rules: ruleList };
  };
  const peeringView = (p: Peering, from: string): S['PrivateNetworkPeering'] => ({
    id: p.id,
    network_id: from,
    peer_network_id: p.left === from ? p.right : p.left,
    region: p.region,
    status: p.status,
    ...(p.status_detail ? { status_detail: p.status_detail } : {}),
    created_at: p.created_at,
    updated_at: p.updated_at,
  });

  route('GET', '/v1/networks', () => {
    enabled();
    return { networks } satisfies S['PrivateNetworkListResponse'];
  });
  route('POST', '/v1/networks', ({ body }) => {
    enabled();
    requirePlan();
    const name = String(body.name ?? '');
    const region = String(body.region ?? '');
    const cidr = String(body.cidr ?? '').trim();
    if (!ID.test(name)) throw invalid('name', name, 'use lowercase letters, digits and dashes');
    if (!ID.test(region))
      throw invalid('region', region, 'use lowercase letters, digits and dashes');
    const p = prefix(cidr);
    if (!p || p.bits < 16 || p.bits > 28 || !rfc1918(cidr))
      throw invalid('cidr', cidr, 'must be an IPv4 RFC1918 range from /16 to /28');
    if (networks.some((n) => n.name === name || (n.region === region && overlaps(n.cidr, cidr))))
      throw new Problem(
        409,
        'conflict',
        'name or regional CIDR conflicts with an existing network'
      );
    const now = new Date().toISOString();
    const created: Network = {
      id: name,
      name,
      region,
      cidr,
      ...policy(cidr, body.allowed_cidrs, body.firewall_rules),
      status: 'ready',
      created_at: now,
      updated_at: now,
    };
    networks.push(created);
    return status(201, created);
  });
  route('GET', '/v1/networks/{id}', ({ params }) => {
    enabled();
    return network(params.id);
  });
  route('DELETE', '/v1/networks/{id}', ({ params }) => {
    enabled();
    const target = network(params.id);
    const attached = [...attachments.values()].some((a) => a.network_id === target.id);
    const peered = peerings.some((p) => p.left === target.id || p.right === target.id);
    if (attached || peered)
      throw new Problem(409, 'conflict', 'detach all apps before deleting the network');
    networks.splice(networks.indexOf(target), 1);
    return NO_CONTENT;
  });
  route('GET', '/v1/networks/{id}/members', ({ params }) => {
    enabled();
    const target = network(params.id);
    const p = prefix(target.cidr)!;
    const capacity = Math.max(0, 2 ** (32 - p.bits) - 3);
    const own = members.filter((m) => m.network_id === target.id);
    return {
      network_id: target.id,
      cidr: target.cidr,
      capacity,
      used: own.length,
      available: capacity - own.length,
      members: own.map(({ network_id: _, ...m }) => m),
    } satisfies S['PrivateNetworkMembersResponse'];
  });
  route('GET', '/v1/networks/{id}/peerings', ({ params }) => {
    enabled();
    const target = network(params.id);
    return {
      peerings: peerings
        .filter((p) => p.left === target.id || p.right === target.id)
        .map((p) => peeringView(p, target.id)),
    } satisfies S['PrivateNetworkPeeringListResponse'];
  });
  route('POST', '/v1/networks/{id}/peerings', ({ params, body }) => {
    enabled();
    requirePlan();
    const left = network(params.id);
    const peerId = String(body.peer_network_id ?? '');
    if (!ID.test(peerId)) throw invalid('peer_network_id', peerId, 'not an identifier');
    const right = networks.find((n) => n.id === peerId);
    if (!right) throw new Problem(404, 'not_found', 'the requested peer network does not exist');
    if (right.id === left.id || right.region !== left.region || overlaps(left.cidr, right.cidr))
      throw invalid(
        'peer_network_id',
        peerId,
        'the networks must be in the same region and use non-overlapping CIDRs'
      );
    if (
      peerings.some(
        (p) => [p.left, p.right].includes(left.id) && [p.left, p.right].includes(right.id)
      )
    )
      throw new Problem(409, 'conflict', 'the two networks are already peered');
    const now = new Date().toISOString();
    const created: Peering = {
      id: `peer-${crypto.randomUUID()}`,
      left: left.id,
      right: right.id,
      region: left.region,
      status: 'pending',
      status_detail: 'network route convergence is pending',
      created_at: now,
      updated_at: now,
    };
    peerings.push(created);
    return status(202, peeringView(created, left.id));
  });
  route('GET', '/v1/networks/{id}/peerings/{peer_id}', ({ params }) => {
    enabled();
    const target = network(params.id);
    const hit = peerings.find(
      (p) => p.id === params.peer_id && (p.left === target.id || p.right === target.id)
    );
    if (!hit) throw new Problem(404, 'not_found', 'the requested peering does not exist');
    return peeringView(hit, target.id);
  });
  route('DELETE', '/v1/networks/{id}/peerings/{peer_id}', ({ params }) => {
    enabled();
    const target = network(params.id);
    const index = peerings.findIndex(
      (p) => p.id === params.peer_id && (p.left === target.id || p.right === target.id)
    );
    if (index < 0) throw new Problem(404, 'not_found', 'the requested peering does not exist');
    peerings.splice(index, 1);
    return NO_CONTENT;
  });
  route('PUT', '/v1/networks/{id}/policy', ({ params, body }) => {
    enabled();
    requirePlan();
    const target = network(params.id);
    if (!Array.isArray(body.allowed_cidrs)) throw invalid('allowed_cidrs', '', 'is required');
    Object.assign(target, policy(target.cidr, body.allowed_cidrs, body.firewall_rules), {
      updated_at: new Date().toISOString(),
    });
    return target;
  });

  const app = (slug: string) => {
    const hit = appBySlug(slug);
    if (!hit) throw new Problem(404, 'not_found', 'no such app');
    return hit;
  };
  const envelope = (attachment: Attachment | null): S['AppPrivateNetworkAttachmentResponse'] => ({
    feature_enabled: true,
    plan_allowed: planAllowed(),
    max_cidrs: plan() === 'scale' ? 64 : planAllowed() ? 16 : 0,
    attachment,
  });
  route('GET', '/v1/apps/{slug}/network/private', ({ params }) => {
    enabled();
    return envelope(attachments.get(app(params.slug).slug) ?? null);
  });
  route('PUT', '/v1/apps/{slug}/network/private', ({ params, body }) => {
    enabled();
    const target = app(params.slug);
    requirePlan();
    const networkId = String(body.network_id ?? '');
    if (!ID.test(networkId)) throw invalid('network_id', networkId, 'not an identifier');
    const owned = networks.find((n) => n.id === networkId);
    if (!owned) throw invalid('network_id', networkId, 'the network is not owned by this account');
    const region = String(body.region ?? '') || owned.region;
    if (region !== owned.region)
      throw invalid('region', region, 'the region must match the Gregale network');
    const cidrs =
      Array.isArray(body.cidrs) && body.cidrs.length ? body.cidrs.map(String) : [owned.cidr];
    if (cidrs.length !== 1 || cidrs[0] !== owned.cidr)
      throw invalid(
        'cidrs',
        cidrs.join(','),
        'Gregale-owned attachments must route the network CIDR'
      );
    const { allowed_cidrs } = policy(owned.cidr, body.allowed_cidrs, []);
    for (let i = members.length - 1; i >= 0; i--)
      if (members[i].owner_id === target.id && members[i].network_id !== owned.id)
        members.splice(i, 1);
    let member = members.find((m) => m.owner_id === target.id && m.network_id === owned.id);
    if (!member) {
      const base = prefix(owned.cidr)!.base;
      const used = new Set(members.filter((m) => m.network_id === owned.id).map((m) => m.address));
      const toIp = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
      let n = base + 2;
      while (used.has(toIp(n))) n++;
      member = {
        id: crypto.randomUUID(),
        owner_type: 'app',
        owner_id: target.id,
        address: toIp(n),
        created_at: new Date().toISOString(),
        network_id: owned.id,
      };
      members.push(member);
    }
    const now = new Date().toISOString();
    const attachment: Attachment = {
      id: attachments.get(target.slug)?.id ?? crypto.randomUUID(),
      network_id: owned.id,
      region,
      cidrs,
      allowed_cidrs,
      address: member.address,
      status: 'pending',
      status_detail: 'waiting for the private network connector',
      created_at: attachments.get(target.slug)?.created_at ?? now,
      updated_at: now,
    };
    attachments.set(target.slug, attachment);
    return status(202, envelope(attachment));
  });
  route('DELETE', '/v1/apps/{slug}/network/private', ({ params }) => {
    enabled();
    const target = app(params.slug);
    attachments.delete(target.slug);
    for (let i = members.length - 1; i >= 0; i--)
      if (members[i].owner_id === target.id) members.splice(i, 1);
    return NO_CONTENT;
  });
}
