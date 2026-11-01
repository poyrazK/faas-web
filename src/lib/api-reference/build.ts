/**
 * The public API reference, derived from `api/openapi.yaml` at build time.
 *
 * The spec is already public — apid serves it at `/v1/openapi.yaml` — so the
 * reference publishes nothing new. It leaves out what only operators can call
 * (the `admin` and `operator` tags, `/v1/admin/…`, `x-internal`) because a
 * customer reading the reference cannot use it, and the browser-only form
 * routes outside `/v1`.
 */

export interface ApiField {
  name: string;
  /** `path`, `query` or `header` for a parameter; absent for a body field. */
  in?: string;
  type: string;
  required: boolean;
  description?: string;
  values?: string[];
}

export interface ApiResponse {
  status: string;
  description: string;
  /** A pretty-printed example body, for success responses only. */
  example?: string;
}

export interface ApiOperation {
  /** Stable anchor: the operationId, or method and path when there is none. */
  id: string;
  method: string;
  path: string;
  summary: string;
  description?: string;
  deprecated?: boolean;
  /** How a caller authenticates, in words a reader can act on. */
  auth: string;
  params: ApiField[];
  body?: { required: boolean; description?: string; fields: ApiField[]; example?: string };
  responses: ApiResponse[];
}

export interface ApiGroup {
  id: string;
  title: string;
  description?: string;
  operations: ApiOperation[];
}

export interface ApiGroupSummary {
  id: string;
  title: string;
  description?: string;
  operations: Pick<ApiOperation, 'id' | 'method' | 'path' | 'summary'>[];
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const OPERATOR_TAGS = new Set(['admin', 'operator']);
const EXAMPLE_LIMIT = 4_000;

/** Groups a customer meets first, in the order they meet them; the rest follow alphabetically. */
const FIRST = [
  'apps',
  'deployments',
  'projects',
  'invocations',
  'jobs',
  'crons',
  'queues',
  'secrets',
  'networking',
  'edge_rules',
  'storage',
  'managed_postgres',
  'observability',
  'webhooks',
  'keys',
  'account',
  'orgs',
  'billing',
];

const TITLES: Record<string, string> = {
  mcp: 'MCP',
  github: 'GitHub',
  managed_postgres: 'Managed Postgres',
  edge_rules: 'Edge rules',
  alert_rules: 'Alert rules',
  inbound_webhooks: 'Inbound webhooks',
  data_pipelines: 'Data pipelines',
  'platform-tenants': 'Platform tenants',
  'exclusive-operations': 'Exclusive operations',
  keys: 'API keys',
  orgs: 'Organizations',
  other: 'Other',
};

export function groupTitle(id: string): string {
  if (TITLES[id]) return TITLES[id];
  const words = id.replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A URL-safe group id: the tag, lowercased, with runs of other characters as dashes. */
export function groupSlug(tag: string): string {
  return (
    tag
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'other'
  );
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

function pretty(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const out = JSON.stringify(value, null, 2);
  if (out === undefined) return undefined;
  return out.length > EXAMPLE_LIMIT ? `${out.slice(0, EXAMPLE_LIMIT)}\n…` : out;
}

export function buildApiReference(spec: unknown): ApiGroup[] {
  if (!isObject(spec) || !isObject(spec.paths)) return [];
  const components = isObject(spec.components) ? spec.components : {};

  const resolve = (node: unknown, seen = new Set<string>()): Json => {
    if (!isObject(node)) return {};
    const ref = typeof node.$ref === 'string' ? node.$ref : undefined;
    if (!ref) return node;
    if (seen.has(ref)) return {};
    seen.add(ref);
    const [, , kind, name] = ref.split('/');
    const bucket = isObject(components[kind]) ? (components[kind] as Json) : {};
    // Siblings of a $ref (an `example`, a `description`) win over the target's.
    const { $ref: _ref, ...siblings } = node;
    return { ...resolve(bucket[name], seen), ...siblings };
  };

  const refName = (node: unknown) =>
    isObject(node) && typeof node.$ref === 'string' ? node.$ref.split('/').pop() : undefined;

  const typeOf = (node: unknown, depth = 0): string => {
    const named = refName(node);
    const schema = resolve(node);
    if (depth > 3) return named ?? 'object';
    for (const key of ['oneOf', 'anyOf'] as const) {
      const options = schema[key];
      if (Array.isArray(options) && options.length)
        return options.map((option) => typeOf(option, depth + 1)).join(' | ');
    }
    if (Array.isArray(schema.allOf) && schema.allOf.length === 1)
      return typeOf(schema.allOf[0], depth + 1);
    const type = Array.isArray(schema.type)
      ? schema.type.filter((t) => t !== 'null').join(' | ')
      : schema.type;
    if (type === 'array') return `${typeOf(schema.items, depth + 1)}[]`;
    if (named && (type === 'object' || type === undefined)) return named;
    if (typeof type === 'string' && type) {
      return typeof schema.format === 'string' ? `${type} (${schema.format})` : type;
    }
    return named ?? 'object';
  };

  const valuesOf = (node: unknown) => {
    const values = resolve(node).enum;
    return Array.isArray(values) && values.length <= 24 ? values.map(String) : undefined;
  };

  /** Top-level properties, with `allOf` parts merged, the way a reader fills them in. */
  const fieldsOf = (node: unknown): { fields: ApiField[]; example?: unknown } => {
    const schema = resolve(node);
    const parts = Array.isArray(schema.allOf) ? schema.allOf.map((part) => resolve(part)) : [];
    const properties: Json = {};
    const required = new Set<string>();
    for (const part of [schema, ...parts]) {
      if (isObject(part.properties)) Object.assign(properties, part.properties);
      if (Array.isArray(part.required)) part.required.forEach((name) => required.add(String(name)));
    }
    const fields = Object.entries(properties).map(([name, property]) => ({
      name,
      type: typeOf(property),
      required: required.has(name),
      description: text(resolve(property).description),
      values: valuesOf(property),
    }));
    // What a caller must send comes first; the rest keep the spec's order.
    fields.sort((a, b) => Number(b.required) - Number(a.required));
    return { fields, example: schema.example };
  };

  const authOf = (op: Json): string => {
    const security = Array.isArray(op.security) ? op.security : undefined;
    if (security && security.length === 0) return 'None';
    const schemes = (security ?? [{ bearerAuth: [] }]).flatMap((entry) =>
      isObject(entry) ? Object.keys(entry) : []
    );
    if (!schemes.length || schemes.includes('bearerAuth')) return 'API key (Bearer)';
    if (schemes.includes('cookieAuth')) return 'Console session';
    return schemes.join(', ');
  };

  const groups = new Map<string, ApiGroup>();
  const tagDescriptions = new Map<string, string>();
  const knownTags = new Set<string>();
  for (const tag of Array.isArray(spec.tags) ? spec.tags : []) {
    if (!isObject(tag) || typeof tag.name !== 'string') continue;
    knownTags.add(tag.name);
    if (text(tag.description)) tagDescriptions.set(tag.name, text(tag.description)!);
  }

  /**
   * An untagged operation goes with the group its path names, read from the
   * most specific segment back (`/v1/apps/{slug}/realtime/…` is realtime, not
   * apps), so it is not stranded in "Other".
   */
  const inferTag = (path: string): string => {
    const segments = path.split('/').filter((segment) => segment && !segment.startsWith('{'));
    for (const segment of segments.slice(1).reverse()) {
      for (const candidate of [segment, segment.split('-')[0], `${segment.split('-')[0]}s`]) {
        const tag = [candidate, candidate.replace(/-/g, '_')].find((name) => knownTags.has(name));
        if (tag && tag !== 'apps' && tag !== 'deployments') return tag;
      }
    }
    return 'other';
  };

  for (const [path, item] of Object.entries(spec.paths)) {
    if (!path.startsWith('/v1/') || path.startsWith('/v1/admin/') || !isObject(item)) continue;
    const shared = Array.isArray(item.parameters) ? item.parameters : [];
    for (const method of METHODS) {
      const op = item[method];
      if (!isObject(op) || op['x-internal']) continue;
      const tags = (Array.isArray(op.tags) ? op.tags : []).map(String);
      if (tags.some((tag) => OPERATOR_TAGS.has(tag))) continue;
      const tag = tags[0] ?? inferTag(path);

      const params = [...shared, ...(Array.isArray(op.parameters) ? op.parameters : [])]
        .map((param) => resolve(param))
        .filter((param) => typeof param.name === 'string' && param.in !== 'cookie')
        .map((param) => ({
          name: String(param.name),
          in: String(param.in),
          type: typeOf(param.schema),
          required: param.required === true || param.in === 'path',
          description: text(param.description),
          values: valuesOf(param.schema),
        }));

      let body: ApiOperation['body'];
      const requestBody = resolve(op.requestBody);
      const content = isObject(requestBody.content) ? requestBody.content : {};
      const media = (content['application/json'] ?? Object.values(content)[0]) as unknown;
      if (isObject(media)) {
        const { fields, example } = fieldsOf(media.schema);
        body = {
          required: requestBody.required === true,
          description: text(requestBody.description),
          fields,
          example: pretty(media.example ?? example),
        };
      }

      const responses = Object.entries(isObject(op.responses) ? op.responses : {}).map(
        ([status, raw]) => {
          const response = resolve(raw);
          const success = status.startsWith('2');
          const body = isObject(response.content)
            ? (response.content['application/json'] as unknown)
            : undefined;
          const schema = isObject(body) ? resolve(body.schema) : {};
          return {
            status,
            description: text(response.description) ?? '',
            example: success && isObject(body) ? pretty(body.example ?? schema.example) : undefined,
          };
        }
      );

      const operation: ApiOperation = {
        id:
          typeof op.operationId === 'string'
            ? op.operationId
            : `${method}-${path}`.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-$/, ''),
        method: method.toUpperCase(),
        path,
        summary: text(op.summary)?.replace(/\.$/, '') ?? `${method.toUpperCase()} ${path}`,
        description: text(op.description),
        deprecated: op.deprecated === true || undefined,
        auth: authOf(op),
        params,
        body,
        responses,
      };

      const id = groupSlug(tag);
      const group = groups.get(id) ?? {
        id,
        title: groupTitle(tag),
        description: tagDescriptions.get(tag),
        operations: [],
      };
      group.operations.push(operation);
      groups.set(id, group);
    }
  }

  const rank = (id: string) => {
    const index = FIRST.indexOf(id.replace(/-/g, '_'));
    return index === -1 ? FIRST.length : index;
  };
  return [...groups.values()].sort(
    (a, b) => rank(a.id) - rank(b.id) || a.title.localeCompare(b.title)
  );
}

export function summarize(groups: ApiGroup[]): ApiGroupSummary[] {
  return groups.map(({ id, title, description, operations }) => ({
    id,
    title,
    description,
    operations: operations.map(({ id, method, path, summary }) => ({ id, method, path, summary })),
  }));
}

/** The curl a reader can paste: the key from the environment, the body as an example. */
export function curlFor(operation: ApiOperation, origin = 'https://api.gregale.dev'): string {
  const lines = [`curl -X ${operation.method} "${origin}${operation.path}"`];
  if (operation.auth.startsWith('API key')) lines.push('  -H "Authorization: Bearer $FAAS_TOKEN"');
  if (operation.body) {
    lines.push('  -H "Content-Type: application/json"');
    const example = operation.body.example?.endsWith('…') ? undefined : operation.body.example;
    if (example) lines.push(`  -d '${example.replace(/'/g, "'\\''")}'`);
  }
  return lines.join(' \\\n');
}
