import type { components } from '../src/lib/api/schema';
import { EMPTY, appBySlug, apps, domains, id, iso } from './data';

/**
 * Dev-mock answers for an app's public raw TCP and UDP listeners
 * (faas handlers_tcp_listeners.go, handlers_udp_listeners.go).
 *
 * The first app declares TCP and UDP ports (seeded here so the shared app
 * fixture stays untouched) and already exposes two of them: a passthrough
 * MQTT listener that is accepting, and a disabled UDP one. The rest of the
 * rules are the handler's own: only declared, non-internal ports by name; a
 * public port in 40000–49999 or the lowest free one; a name or port in use
 * is 409 `conflict`; TLS termination needs a verified app-wide domain of the
 * app and starts disabled; a TLS change disables the listener; UDP starts
 * disabled and holds at most 16 reservations per app (`udp_listener_limit`).
 */

type S = components['schemas'];
interface MockCtx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
}
type Register = (method: string, template: string, handler: (ctx: MockCtx) => unknown) => void;
type ProblemCtor = new (status: number, code: string, detail?: string) => Error;

const MIN = 40000;
const MAX = 49999;
const UDP_PER_APP = 16;
const status = (code: number, body: unknown) => ({ __status: code, body });

const tcp = new Map<string, S['TCPListenerResponse'][]>();
const udp = new Map<string, S['UDPListenerResponse'][]>();

function seed() {
  const app = apps[0];
  if (!app) return;
  app.manifest = {
    ...app.manifest,
    ports: [
      { name: 'mqtt', port: 1883, protocol: 'tcp' },
      { name: 'mqtts', port: 8883, protocol: 'tcp' },
      { port: 5432, protocol: 'tcp' },
      { name: 'metrics', port: 9100, protocol: 'tcp', internal: true },
      { name: 'game', port: 7777, protocol: 'udp' },
      { port: 5353, protocol: 'udp' },
    ],
  };
  tcp.set(app.slug, [
    {
      id: id(),
      name: 'mqtt',
      guest_port: 1883,
      public_port: 40001,
      protocol: 'tcp',
      enabled: true,
      created_at: iso(6 * 86_400_000),
      updated_at: iso(6 * 86_400_000),
      tls: { mode: 'passthrough' },
    },
  ]);
  udp.set(app.slug, [
    {
      id: id(),
      name: 'game',
      guest_port: 7777,
      public_port: 40100,
      protocol: 'udp',
      enabled: false,
      created_at: iso(2 * 86_400_000),
      updated_at: iso(2 * 86_400_000),
    },
  ]);
}

const usedPorts = () =>
  new Set([...tcp.values(), ...udp.values()].flat().map((l) => l.public_port));

export function registerListenerMocks(route: Register, Problem: ProblemCtor, NO_CONTENT: symbol) {
  if (!EMPTY) seed();

  const appOf = (slug: string) => {
    const app = appBySlug(slug);
    if (!app) throw new Problem(404, 'not_found', 'no such app');
    return app;
  };
  const declared = (slug: string, protocol: 'tcp' | 'udp', name: string, port: number) =>
    (appOf(slug).manifest?.ports ?? []).some(
      (p) =>
        !p.internal &&
        (p.protocol ?? 'tcp') === protocol &&
        p.port === port &&
        ((p.name ?? '').toLowerCase() || `${protocol}-${p.port}`) === name
    );
  const publicPort = (requested: unknown) => {
    const used = usedPorts();
    if (requested === undefined || requested === 0) {
      for (let p = MIN; p <= MAX; p++) if (!used.has(p)) return p;
      throw new Problem(503, 'capacity', 'TCP listener public port range is exhausted');
    }
    const port = Number(requested);
    if (!Number.isInteger(port) || port < MIN || port > MAX)
      throw new Problem(400, 'validation_failed', `public_port must be between ${MIN} and ${MAX}`);
    if (used.has(port))
      throw new Problem(409, 'conflict', 'the listener name or public port is already in use');
    return port;
  };
  const tlsOf = (slug: string, raw: unknown): S['TCPListenerTLSConfig'] => {
    const tls = (raw ?? {}) as { mode?: string; hostname?: string };
    const mode = tls.mode ?? 'passthrough';
    const hostname = (tls.hostname ?? '').trim().toLowerCase();
    if (mode === 'passthrough') {
      if (hostname)
        throw new Problem(400, 'validation_failed', 'passthrough listeners do not take a hostname');
      return { mode: 'passthrough' };
    }
    if (mode !== 'terminate')
      throw new Problem(400, 'validation_failed', 'mode must be passthrough or terminate');
    const app = appOf(slug);
    const owned =
      !hostname.includes('*') &&
      domains.some(
        (d) => d.domain === hostname && d.app_id === app.id && d.verified && !d.environment
      );
    if (!owned)
      throw new Problem(
        400,
        'validation_failed',
        'hostname must be a verified app-wide domain owned by this app'
      );
    return { mode: 'terminate', hostname };
  };
  const listOf = <T>(map: Map<string, T[]>, slug: string) => {
    appOf(slug);
    if (!map.has(slug)) map.set(slug, []);
    return map.get(slug)!;
  };
  const find = <T extends { name: string }>(map: Map<string, T[]>, slug: string, name: string) => {
    const hit = listOf(map, slug).find((l) => l.name === name);
    if (!hit) throw new Problem(404, 'not_found', 'the app or listener does not exist');
    return hit;
  };

  route('GET', '/v1/apps/{slug}/tcp-listeners', ({ params }) => listOf(tcp, params.slug));
  route('POST', '/v1/apps/{slug}/tcp-listeners', ({ params, body }) => {
    const list = listOf(tcp, params.slug);
    const name = String(body.name ?? '')
      .trim()
      .toLowerCase();
    const guest = Number(body.guest_port);
    if (!name) throw new Problem(400, 'validation_failed', 'name is required');
    if (!declared(params.slug, 'tcp', name, guest))
      throw new Problem(
        400,
        'validation_failed',
        `name and guest_port must match a declared TCP listener in the app manifest; declare the port in a Compose project's ports (the listener is named tcp-<port>) or in the app's ports field (PATCH /v1/apps/${params.slug}), then retry`
      );
    const tls = tlsOf(params.slug, body.tls);
    if (list.some((l) => l.name === name))
      throw new Problem(409, 'conflict', 'the listener name or public port is already in use');
    const now = new Date().toISOString();
    const created: S['TCPListenerResponse'] = {
      id: id(),
      name,
      guest_port: guest,
      public_port: publicPort(body.public_port),
      protocol: 'tcp',
      enabled: tls.mode === 'passthrough',
      created_at: now,
      updated_at: now,
      tls,
    };
    list.push(created);
    return status(201, created);
  });
  route('PATCH', '/v1/apps/{slug}/tcp-listeners/{name}', ({ params, body }) => {
    const listener = find(tcp, params.slug, params.name);
    const hasEnabled = typeof body.enabled === 'boolean';
    const hasTls = body.tls !== undefined;
    if (hasEnabled === hasTls)
      throw new Problem(
        400,
        'validation_failed',
        'supply exactly one of enabled or tls; TLS changes disable the listener'
      );
    if (hasTls) {
      listener.tls = tlsOf(params.slug, body.tls);
      listener.enabled = false;
    } else {
      if (body.enabled) tlsOf(params.slug, listener.tls);
      listener.enabled = Boolean(body.enabled);
    }
    listener.updated_at = new Date().toISOString();
    return listener;
  });
  route('DELETE', '/v1/apps/{slug}/tcp-listeners/{name}', ({ params }) => {
    const listener = find(tcp, params.slug, params.name);
    const list = listOf(tcp, params.slug);
    list.splice(list.indexOf(listener), 1);
    return NO_CONTENT;
  });
  route('GET', '/v1/apps/{slug}/tcp-listeners/{name}/tls-status', ({ params }) => {
    const listener = find(tcp, params.slug, params.name);
    // Two edges: one has the certificate, the other has not reported within a
    // minute, which the API reports as unknown. Passthrough has nothing to observe.
    const observations: S['TCPListenerTLSCertificateStatus'][] =
      listener.tls.mode === 'terminate'
        ? [
            {
              edge_id: 'edge-fra1-a',
              status: 'ready',
              observed_at: iso(20_000),
              not_after: iso(-60 * 86_400_000),
            },
            { edge_id: 'edge-fra1-b', status: 'unknown', observed_at: iso(5 * 60_000) },
          ]
        : [];
    return {
      name: listener.name,
      tls: listener.tls,
      enabled: listener.enabled,
      scope: 'observed_edges',
      observations,
    } satisfies S['TCPListenerTLSStatusResponse'];
  });

  route('GET', '/v1/apps/{slug}/udp-listeners', ({ params }) => listOf(udp, params.slug));
  route('POST', '/v1/apps/{slug}/udp-listeners', ({ params, body }) => {
    const list = listOf(udp, params.slug);
    const name = String(body.name ?? '')
      .trim()
      .toLowerCase();
    const guest = Number(body.guest_port);
    if (!name) throw new Problem(400, 'validation_failed', 'name is required');
    if (!declared(params.slug, 'udp', name, guest))
      throw new Problem(
        400,
        'validation_failed',
        'name and guest_port must match a declared UDP listener in the app manifest'
      );
    if (list.some((l) => l.name === name))
      throw new Problem(409, 'conflict', 'the listener name or public port is already in use');
    if (list.length >= UDP_PER_APP)
      throw new Problem(
        409,
        'udp_listener_limit',
        'Delete an existing UDP listener before reserving another public port. Disabled listeners still reserve their ports.'
      );
    const now = new Date().toISOString();
    const created: S['UDPListenerResponse'] = {
      id: id(),
      name,
      guest_port: guest,
      public_port: publicPort(body.public_port),
      protocol: 'udp',
      enabled: false,
      created_at: now,
      updated_at: now,
    };
    list.push(created);
    return status(201, created);
  });
  route('PATCH', '/v1/apps/{slug}/udp-listeners/{name}', ({ params, body }) => {
    const listener = find(udp, params.slug, params.name);
    if (typeof body.enabled !== 'boolean')
      throw new Problem(400, 'validation_failed', 'enabled is required');
    if (body.enabled && !declared(params.slug, 'udp', listener.name, listener.guest_port))
      throw new Problem(
        400,
        'validation_failed',
        'listener no longer matches a declared UDP port in the app manifest'
      );
    listener.enabled = body.enabled;
    listener.updated_at = new Date().toISOString();
    return listener;
  });
  route('DELETE', '/v1/apps/{slug}/udp-listeners/{name}', ({ params }) => {
    const listener = find(udp, params.slug, params.name);
    const list = listOf(udp, params.slug);
    list.splice(list.indexOf(listener), 1);
    return NO_CONTENT;
  });
}
