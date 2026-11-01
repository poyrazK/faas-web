import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { buildApiReference, curlFor, groupSlug, groupTitle, summarize } from './build';

const spec = {
  tags: [
    { name: 'apps', description: 'App lifecycle.' },
    { name: 'realtime', description: 'Channels.' },
    { name: 'admin' },
  ],
  paths: {
    '/v1/apps': {
      post: {
        tags: ['apps'],
        operationId: 'createApp',
        summary: 'Create an app.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateApp', example: { slug: 'hello' } },
            },
          },
        },
        responses: {
          '201': {
            description: 'The new app.',
            content: { 'application/json': { example: { id: 'a1' } } },
          },
          '400': { $ref: '#/components/responses/Invalid' },
        },
      },
    },
    '/v1/apps/{slug}/realtime/{id}/signals': {
      parameters: [{ name: 'slug', in: 'path', schema: { type: 'string' } }],
      post: { summary: 'Send a signal', responses: {} },
    },
    '/v1/admin/status': { get: { tags: ['apps'], summary: 'Admin', responses: {} } },
    '/v1/operator-thing': { get: { tags: ['admin'], summary: 'Operator', responses: {} } },
    '/v1/hidden': { get: { tags: ['apps'], 'x-internal': true, summary: 'Hidden', responses: {} } },
    '/dashboard/form': { post: { tags: ['apps'], summary: 'Form post', responses: {} } },
    '/v1/health': { get: { tags: ['apps'], summary: 'Health', security: [], responses: {} } },
  },
  components: {
    schemas: {
      CreateApp: {
        type: 'object',
        required: ['slug'],
        properties: {
          profiling: { $ref: '#/components/schemas/Profiling' },
          slug: { type: 'string', description: 'The `tag-` prefix is reserved.' },
          type: { type: 'string', enum: ['app', 'function'] },
          callers: { type: 'array', items: { type: 'string' } },
        },
      },
      Profiling: { type: 'object' },
    },
    responses: { Invalid: { description: 'The body failed validation (validation_failed).' } },
  },
};

describe('buildApiReference', () => {
  const groups = buildApiReference(spec);
  const ops = groups.flatMap((group) => group.operations);

  it('publishes only what a customer can call', () => {
    expect(ops.map((op) => op.summary).sort()).toEqual([
      'Create an app',
      'Health',
      'Send a signal',
    ]);
  });

  it('files an untagged operation by the most specific segment of its path', () => {
    expect(groups.find((g) => g.id === 'realtime')?.operations.map((op) => op.summary)).toEqual([
      'Send a signal',
    ]);
  });

  it('lists required body fields first, with types, values and descriptions', () => {
    const create = ops.find((op) => op.id === 'createApp')!;
    expect(create.body?.fields).toEqual([
      expect.objectContaining({ name: 'slug', type: 'string', required: true }),
      expect.objectContaining({ name: 'profiling', type: 'Profiling', required: false }),
      expect.objectContaining({ name: 'type', values: ['app', 'function'] }),
      expect.objectContaining({ name: 'callers', type: 'string[]' }),
    ]);
  });

  it('resolves shared responses and keeps an example only for success', () => {
    const create = ops.find((op) => op.id === 'createApp')!;
    expect(create.responses).toEqual([
      { status: '201', description: 'The new app.', example: '{\n  "id": "a1"\n}' },
      {
        status: '400',
        description: 'The body failed validation (validation_failed).',
        example: undefined,
      },
    ]);
  });

  it('treats path parameters as required and names how to authenticate', () => {
    const signal = ops.find((op) => op.summary === 'Send a signal')!;
    expect(signal.params).toEqual([expect.objectContaining({ name: 'slug', required: true })]);
    expect(signal.auth).toBe('API key (Bearer)');
    expect(ops.find((op) => op.summary === 'Health')?.auth).toBe('None');
  });

  it('gives a curl that reads the key from the environment and sends the example body', () => {
    const create = ops.find((op) => op.id === 'createApp')!;
    expect(curlFor(create)).toBe(
      [
        'curl -X POST "https://api.gregale.dev/v1/apps" \\',
        '  -H "Authorization: Bearer $FAAS_TOKEN" \\',
        '  -H "Content-Type: application/json" \\',
        `  -d '{\n  "slug": "hello"\n}'`,
      ].join('\n')
    );
  });

  it('summarizes without the operation details', () => {
    expect(summarize(groups)[0].operations[0]).toEqual({
      id: 'createApp',
      method: 'POST',
      path: '/v1/apps',
      summary: 'Create an app',
    });
  });

  it('names groups for people and slugs them for URLs', () => {
    expect(groupTitle('managed_postgres')).toBe('Managed Postgres');
    expect(groupTitle('platform-tenants')).toBe('Platform tenants');
    expect(groupSlug('edge_rules')).toBe('edge-rules');
  });
});

describe('the vendored spec', () => {
  const groups = buildApiReference(load(readFileSync('api/openapi.yaml', 'utf8')));
  const ops = groups.flatMap((group) => group.operations);

  it('builds a reference with apps first', () => {
    expect(groups[0].id).toBe('apps');
    expect(ops.length).toBeGreaterThan(1000);
  });

  it('leaves out operator surfaces and leaves nothing ungrouped', () => {
    expect(ops.filter((op) => op.path.startsWith('/v1/admin/'))).toEqual([]);
    expect(groups.map((g) => g.id)).not.toContain('admin');
    expect(groups.map((g) => g.id)).not.toContain('operator');
    expect(groups.map((g) => g.id)).not.toContain('other');
  });

  it('gives every operation on a page its own anchor', () => {
    for (const group of groups) {
      const ids = group.operations.map((op) => op.id);
      expect(new Set(ids).size, group.id).toBe(ids.length);
    }
  });
});
