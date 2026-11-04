import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { ServerResponse } from 'node:http';
import type { components } from '../src/lib/api/schema';
import { apps, deployments, EMPTY, id as hexId, iso, NOW } from './data';

/**
 * Dev-mock answers for on-demand profile captures (faas ADR-1155,
 * docs/profiling.md; pkg/apid/profilecapture), with the rules the console
 * explains:
 *
 * - a capture walks queued → capturing → ready from its age; one per app at
 *   a time (409 `conflict`), 60 per account per hour (429 `quota_exhausted`),
 *   none on Free (402 `plan_feature_gated`);
 * - a view or diff of a capture that is not ready is 409 `conflict`; block
 *   and mutex captures of a non-Go app are ready and empty;
 * - the pprof download is a gzip body under apid's own filename.
 *
 * The first app has a capture of each trigger (you, memory pressure with an
 * OOM kill, a slow request, CPU saturation) and one from an instance with no
 * collector. `MOCK_HIDDEN_CAPABILITIES=profile-captures` answers 404, as
 * apid's capability gate does. Profiles are fixtures shaped like apid's
 * merged view, not samples.
 */

type S = components['schemas'];
type Capture = S['ProfileCapture'];
type Kind = Capture['kinds'][number];
type Stack = S['ProfileCaptureStack'];
type StackDelta = S['ProfileCaptureStackDelta'];
interface MockCtx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  res: ServerResponse;
}
type Register = (method: string, template: string, handler: (ctx: MockCtx) => unknown) => void;
type ProblemCtor = new (
  status: number,
  code: string,
  detail?: string,
  extra?: Record<string, unknown>
) => Error;
export interface ProfileCaptureMockOptions {
  hidden: (capability: string) => boolean;
  plan: () => string;
}

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const KINDS: Kind[] = ['cpu', 'heap', 'stacks', 'block', 'mutex'];
const UNIT: Record<Kind, S['ProfileCaptureView']['unit']> = {
  cpu: 'nanoseconds',
  heap: 'bytes',
  stacks: 'count',
  block: 'nanoseconds',
  mutex: 'nanoseconds',
};
const status = (code: number, body: unknown) => ({ __status: code, body });
const at = (ms: number) => new Date(ms).toISOString();

type Frame = { name: string; file?: string; line?: number; value?: number; children?: Frame[] };
const MS = 1_000_000;
/** One tree per kind, in the view's unit; leaves carry their own value. */
const TREES: Record<Kind, Frame[]> = {
  cpu: [
    {
      name: 'http.(*conn).serve',
      file: 'net/http/server.go',
      line: 2092,
      children: [
        {
          name: 'main.handleOrder',
          file: 'orders.go',
          line: 41,
          value: 40 * MS,
          children: [
            { name: 'main.loadOrder', file: 'orders.go', line: 88, value: 610 * MS },
            { name: 'encoding/json.Marshal', file: 'encoding/json/encode.go', value: 220 * MS },
            { name: 'main.hashToken', file: 'auth.go', line: 17, value: 1_340 * MS },
          ],
        },
      ],
    },
    { name: 'runtime.gcBgMarkWorker', file: 'runtime/mgc.go', value: 290 * MS },
  ],
  heap: [
    {
      name: 'main.(*cache).put',
      file: 'cache.go',
      line: 54,
      value: 3 * 1024 * 1024,
      children: [{ name: 'runtime.makemap', file: 'runtime/map.go', value: 768 * 1024 }],
    },
    { name: 'encoding/json.Marshal', file: 'encoding/json/encode.go', value: 512 * 1024 },
    { name: 'bufio.NewReaderSize', file: 'bufio/bufio.go', value: 256 * 1024 },
  ],
  stacks: [
    {
      name: 'net/http.(*conn).serve',
      file: 'net/http/server.go',
      line: 2092,
      children: [
        {
          name: 'main.handleOrder',
          file: 'orders.go',
          line: 41,
          children: [{ name: 'database/sql.(*DB).conn', file: 'database/sql/sql.go', value: 12 }],
        },
      ],
    },
    { name: 'runtime.gopark', file: 'runtime/proc.go', value: 4 },
  ],
  block: [
    {
      name: 'main.(*pool).acquire',
      file: 'pool.go',
      line: 33,
      children: [{ name: 'runtime.chanrecv1', file: 'runtime/chan.go', value: 1_900 * MS }],
    },
  ],
  mutex: [
    {
      name: 'sync.(*Mutex).Unlock',
      file: 'sync/mutex.go',
      children: [{ name: 'main.(*cache).put', file: 'cache.go', line: 61, value: 420 * MS }],
    },
  ],
};

/** A node's value is its own plus its children's, as apid's merged tree reports it. */
function toStack(
  frame: Frame,
  scale: (name: string) => number,
  source: (f: Frame) => Stack['source']
): Stack {
  const children = (frame.children ?? []).map((c) => toStack(c, scale, source));
  const own = Math.round((frame.value ?? 0) * scale(frame.name));
  const value = own + children.reduce((n, c) => n + c.value, 0);
  const loc = source(frame);
  return {
    name: frame.name,
    ...(frame.file ? { file: frame.file } : {}),
    ...(frame.line ? { line: frame.line } : {}),
    ...(loc ? { source: loc } : {}),
    value,
    ...(children.length ? { children } : {}),
  };
}

function functionsOf(root: Stack): S['ProfileCaptureFunction'][] {
  const byName = new Map<string, S['ProfileCaptureFunction']>();
  const walk = (node: Stack) => {
    const self = node.value - (node.children ?? []).reduce((n, c) => n + c.value, 0);
    const row = byName.get(node.name);
    if (row) {
      row.self += self;
      row.total += node.value;
    } else
      byName.set(node.name, {
        name: node.name,
        ...(node.file ? { file: node.file } : {}),
        ...(node.line ? { line: node.line } : {}),
        ...(node.source ? { source: node.source } : {}),
        self,
        total: node.value,
      });
    (node.children ?? []).forEach(walk);
  };
  (root.children ?? []).forEach(walk);
  return [...byName.values()].sort((a, b) => b.self - a.self);
}

function mergeDelta(base: Stack | undefined, cand: Stack | undefined): StackDelta {
  const node = (cand ?? base)!;
  const names = new Set([
    ...(base?.children ?? []).map((c) => c.name),
    ...(cand?.children ?? []).map((c) => c.name),
  ]);
  const children = [...names].map((name) =>
    mergeDelta(
      base?.children?.find((c) => c.name === name),
      cand?.children?.find((c) => c.name === name)
    )
  );
  const baseline = base?.value ?? 0;
  const candidate = cand?.value ?? 0;
  return {
    name: node.name,
    ...(node.file ? { file: node.file } : {}),
    ...(node.line ? { line: node.line } : {}),
    baseline,
    candidate,
    delta: candidate - baseline,
    ...(children.length ? { children } : {}),
  };
}

export function registerProfileCaptureMocks(
  route: Register,
  Problem: ProblemCtor,
  noContent: symbol,
  options: ProfileCaptureMockOptions
) {
  const captures = new Map<string, Capture[]>(apps.map((a) => [a.slug, []]));
  /** When a mock capture was asked for, so its age decides its status. */
  const started = new Map<string, number>();

  const appOf = (slug: string) => {
    const app = apps.find((a) => a.slug === slug);
    if (!app) throw new Problem(404, 'not_found', 'the app does not exist');
    return app;
  };
  const gate = (slug: string) => {
    if (options.hidden('profile-captures'))
      throw new Problem(404, 'not_found', 'no such API route');
    const plan = options.plan();
    if (plan === 'free')
      throw new Problem(
        402,
        'plan_feature_gated',
        "the free plan doesn't include profiling; upgrade to Hobby or higher."
      );
    return appOf(slug);
  };
  const isGo = (slug: string) => (appOf(slug).runtime ?? '').startsWith('go');
  const deploymentOf = (appId: string) =>
    deployments.find((d) => d.app_id === appId && d.status === 'live') ??
    deployments.find((d) => d.app_id === appId);

  const advance = (capture: Capture, now = Date.now()) => {
    const begun = started.get(capture.id);
    if (begun === undefined || capture.status === 'ready' || capture.status === 'failed')
      return capture;
    const age = now - begun;
    const window = Math.min(capture.duration_seconds, 6) * SEC;
    if (age >= 1.5 * SEC + window) {
      capture.status = 'ready';
      capture.processes = 1;
      capture.profiles = capture.kinds.map((kind) => ({ kind, process_id: '7', bytes: 2048 }));
      capture.completed_at = at(begun + 1.5 * SEC + window);
    } else if (age >= 1.5 * SEC) capture.status = 'capturing';
    return capture;
  };
  const listOf = (slug: string) => {
    const list = captures.get(slug) ?? [];
    for (const capture of list) advance(capture);
    return list.filter((c) => Date.parse(c.expires_at) > Date.now());
  };
  const find = (slug: string, id: string) => {
    const capture = listOf(slug).find((c) => c.id === id);
    if (!capture) throw new Problem(404, 'not_found', 'profile capture does not exist');
    return capture;
  };
  const kindOf = (capture: Capture, raw: string | null) => {
    const kind = (raw || capture.kinds[0]) as Kind;
    if (!capture.kinds.includes(kind))
      throw new Problem(400, 'validation_failed', "kind must be one of the capture's kinds");
    return kind;
  };
  const requireReady = (capture: Capture) => {
    if (capture.status !== 'ready')
      throw new Problem(409, 'conflict', `profile capture is ${capture.status}`);
  };
  /** A newer capture holds more in the cache, so a comparison shows what grew. */
  const scaleFor = (slug: string, capture: Capture) => {
    const order = [...(captures.get(slug) ?? [])].reverse().findIndex((c) => c.id === capture.id);
    return (name: string) => (name === 'main.(*cache).put' ? 1 + Math.max(0, order) * 0.6 : 1);
  };
  const sourceFor = (slug: string, sha: string) => (frame: Frame) =>
    frame.line && !frame.file?.includes('/')
      ? {
          url: `https://github.com/acme/${slug}/blob/${sha}/${frame.file}#L${frame.line}`,
          path: frame.file!,
          line: frame.line,
        }
      : undefined;
  const treeOf = (slug: string, capture: Capture, kind: Kind, sha: string): Stack => {
    const empty = (kind === 'block' || kind === 'mutex') && !isGo(slug);
    const children = empty
      ? []
      : TREES[kind].map((f) => toStack(f, scaleFor(slug, capture), sourceFor(slug, sha)));
    return { name: 'root', value: children.reduce((n, c) => n + c.value, 0), children };
  };
  const shaOf = (capture: Capture) =>
    deployments.find((d) => d.id === capture.deployment_id)?.commit_sha ??
    'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';

  // --- Seeds -------------------------------------------------------------------

  if (!EMPTY && apps.length > 0) {
    const app = apps[0];
    const dep = deploymentOf(app.id);
    const instance = randomUUID();
    const ready = (ago: number, rest: Partial<Capture>): Capture => {
      const kinds = rest.kinds ?? ['cpu', 'heap'];
      return {
        id: randomUUID(),
        app_id: app.id,
        status: 'ready',
        kinds,
        duration_seconds: 10,
        trigger: 'manual',
        instance_id: instance,
        ...(dep ? { deployment_id: dep.id } : {}),
        processes: 1,
        profiles: kinds.map((kind) => ({ kind, process_id: '7', bytes: 2048 })),
        created_at: iso(ago),
        completed_at: iso(ago - 11 * SEC),
        expires_at: at(NOW - ago + 7 * DAY),
        ...rest,
      };
    };
    captures.set(app.slug, [
      ready(40 * MIN, {}),
      ready(2 * HOUR, {
        trigger: 'slow_request',
        kinds: ['stacks', 'cpu'],
        duration_seconds: 5,
        request_id: hexId(),
        request_trace_id: hexId(),
        trigger_detail: 'a GET /orders/{id} request was in flight for 10s',
      }),
      ready(5 * HOUR, {
        trigger: 'memory_pressure',
        kinds: ['heap'],
        trigger_detail: 'guest memory available fell to 31 MiB of 246 MiB (180 MiB anonymous)',
        partial: true,
        reason: 'the workload was OOM-killed 4s into the window; heap is the last checkpoint',
        oom_killed_at: iso(5 * HOUR - 14 * SEC),
        oom_peak_mb: 263,
        oom_plan_mb: 256,
      }),
      ready(26 * HOUR, {
        trigger: 'cpu_saturation',
        kinds: ['cpu'],
        trigger_detail: 'CPU use at 98% of the 500m limit for 30s',
      }),
      ready(3 * DAY, {
        kinds: ['cpu'],
        processes: 0,
        profiles: [],
        reason: 'the instance has no profiling collector; redeploy to add one',
      }),
    ]);
  }

  // --- Routes --------------------------------------------------------------------

  route('GET', '/v1/apps/{slug}/profiles/captures', ({ params }) => {
    gate(params.slug);
    return { captures: listOf(params.slug).slice(0, 50) };
  });

  route('POST', '/v1/apps/{slug}/profiles/captures', ({ params, body }) => {
    const app = gate(params.slug);
    const kinds = (Array.isArray(body.kinds) && body.kinds.length ? body.kinds : ['cpu']) as Kind[];
    if (new Set(kinds).size !== kinds.length || kinds.some((k) => !KINDS.includes(k)))
      throw new Problem(
        400,
        'validation_failed',
        'kinds must list distinct values of cpu, heap, stacks, block or mutex'
      );
    const duration = body.duration_seconds === undefined ? 10 : Number(body.duration_seconds);
    if (!Number.isInteger(duration) || duration < 1 || duration > 60)
      throw new Problem(400, 'validation_failed', 'duration_seconds must be between 1 and 60');
    const list = listOf(params.slug);
    if (list.some((c) => c.status === 'queued' || c.status === 'capturing'))
      throw new Problem(409, 'conflict', "wait for the app's current profile capture to finish");
    const lastHour = [...captures.values()]
      .flat()
      .filter((c) => c.trigger === 'manual' && Date.now() - Date.parse(c.created_at) < HOUR).length;
    if (lastHour >= 60)
      throw new Problem(
        429,
        'quota_exhausted',
        'an account can start 60 profile captures per hour',
        {
          limit: 60,
          observed: 60,
        }
      );
    const now = Date.now();
    const dep = deploymentOf(app.id);
    const capture: Capture = {
      id: randomUUID(),
      app_id: app.id,
      status: 'queued',
      kinds,
      duration_seconds: duration,
      trigger: 'manual',
      ...(typeof body.instance_id === 'string' && body.instance_id
        ? { requested_instance_id: body.instance_id, instance_id: body.instance_id }
        : { instance_id: randomUUID() }),
      ...(dep ? { deployment_id: dep.id } : {}),
      processes: 0,
      profiles: [],
      created_at: at(now),
      expires_at: at(now + 7 * DAY),
    };
    started.set(capture.id, now);
    captures.get(params.slug)!.unshift(capture);
    return status(202, capture);
  });

  route('GET', '/v1/apps/{slug}/profiles/captures/{id}', ({ params }) => {
    gate(params.slug);
    return find(params.slug, params.id);
  });

  route('DELETE', '/v1/apps/{slug}/profiles/captures/{id}', ({ params }) => {
    gate(params.slug);
    const capture = find(params.slug, params.id);
    const list = captures.get(params.slug)!;
    list.splice(list.indexOf(capture), 1);
    return noContent;
  });

  route('GET', '/v1/apps/{slug}/profiles/captures/{id}/view', ({ params, query }) => {
    gate(params.slug);
    const capture = find(params.slug, params.id);
    const kind = kindOf(capture, query.get('kind'));
    requireReady(capture);
    const sha = shaOf(capture);
    const flamegraph = treeOf(params.slug, capture, kind, sha);
    const functions = functionsOf(flamegraph);
    return {
      capture,
      kind,
      unit: UNIT[kind],
      total: flamegraph.value,
      functions,
      flamegraph,
      empty: functions.length === 0,
      source: {
        available: true,
        repository: `acme/${params.slug}`,
        commit_sha: sha,
        commit_url: `https://github.com/acme/${params.slug}/commit/${sha}`,
      },
    };
  });

  route('GET', '/v1/apps/{slug}/profiles/captures/{id}/pprof', ({ params, query, res }) => {
    gate(params.slug);
    const capture = find(params.slug, params.id);
    const kind = kindOf(capture, query.get('kind'));
    requireReady(capture);
    if (!capture.profiles.some((p) => p.kind === kind))
      throw new Problem(404, 'not_found', `the capture has no ${kind} profile`);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="profile-${capture.id}-${kind}.pb.gz"`
    );
    res.end(gzipSync(Buffer.from(`mock ${kind} profile for capture ${capture.id}\n`)));
    return undefined;
  });

  route('GET', '/v1/apps/{slug}/profiles/captures/{id}/diff', ({ params, query }) => {
    gate(params.slug);
    const candidate = find(params.slug, params.id);
    const baseId = query.get('base') ?? '';
    if (!baseId || baseId === candidate.id)
      throw new Problem(400, 'validation_failed', 'base must name another capture of this app');
    const baseline = listOf(params.slug).find((c) => c.id === baseId);
    if (!baseline)
      throw new Problem(400, 'validation_failed', 'base must name another capture of this app');
    requireReady(candidate);
    requireReady(baseline);
    const shared = candidate.kinds.filter((k) => baseline.kinds.includes(k));
    const asked = query.get('kind') as Kind | null;
    const kind = asked ?? (shared.includes('heap') ? 'heap' : shared[0]);
    if (!kind || !shared.includes(kind))
      throw new Problem(400, 'validation_failed', 'both captures must include the compared kind');
    const base = treeOf(params.slug, baseline, kind, shaOf(baseline));
    const cand = treeOf(params.slug, candidate, kind, shaOf(candidate));
    const baseFns = new Map(functionsOf(base).map((f) => [f.name, f.self]));
    const candFns = new Map(functionsOf(cand).map((f) => [f.name, f.self]));
    const functions = [...new Set([...baseFns.keys(), ...candFns.keys()])]
      .map((name) => {
        const b = baseFns.get(name) ?? 0;
        const c = candFns.get(name) ?? 0;
        return { name, baseline: b, candidate: c, delta: c - b };
      })
      .sort((a, b) => b.delta - a.delta);
    const warnings: string[] = [];
    if (baseline.duration_seconds !== candidate.duration_seconds)
      warnings.push(
        `the captures cover different windows (${baseline.duration_seconds}s and ${candidate.duration_seconds}s); values are not rescaled`
      );
    if (baseline.deployment_id !== candidate.deployment_id)
      warnings.push(
        'the captures come from different deployments; code changes can move cost between functions'
      );
    return {
      baseline,
      candidate,
      kind,
      unit: UNIT[kind],
      baseline_total: base.value,
      candidate_total: cand.value,
      delta: cand.value - base.value,
      functions,
      flamegraph: mergeDelta(base, cand),
      warnings,
    };
  });
}
