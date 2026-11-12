import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { registerSupportMocks } from './support';
import type { components } from '../src/lib/api/schema';

type S = components['schemas'];
type Handler = Parameters<Parameters<typeof registerSupportMocks>[0]>[2];
class Problem extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
  }
}
function setup() {
  const handlers = new Map<string, Handler>();
  registerSupportMocks(
    (method, path, handler) => handlers.set(`${method} ${path}`, handler),
    Problem
  );
  const call = (
    method: string,
    suffix: string,
    opts: {
      org?: string;
      ticket?: string;
      body?: Record<string, unknown>;
      query?: string;
      key?: string;
    } = {}
  ) => {
    const base = opts.org ? '/v1/orgs/{org}/support' : '/v1/support';
    return handlers.get(`${method} ${base}${suffix}`)!({
      params: {
        ...(opts.org ? { org: opts.org } : {}),
        ...(opts.ticket ? { ticket: opts.ticket } : {}),
      },
      body: opts.body ?? {},
      query: new URLSearchParams(opts.query),
      req: { headers: { 'idempotency-key': opts.key ?? randomUUID() } },
    });
  };
  return { handlers, call };
}
const request = { subject: 'Test support', category: 'deployment', body: 'A health check fails.' };

describe('support mock contract', () => {
  it('registers every public Support operation from the vendored spec', () => {
    const { handlers } = setup();
    const paths = new Set(
      [...readFileSync('api/openapi.yaml', 'utf8').matchAll(/^ {2}(\/\S+):\s*$/gm)].map((m) => m[1])
    );
    expect(handlers.size).toBe(22);
    for (const operation of handlers.keys())
      expect(paths.has(operation.slice(operation.indexOf(' ') + 1)), operation).toBe(true);
  });

  it('separates personal, company, and personal-organization collections', () => {
    const { call } = setup();
    const personal = call('GET', '/tickets') as S['SupportTicketPage'];
    const company = call('GET', '/tickets', { org: 'acme-corp' }) as S['SupportTicketPage'];
    const personalOrg = call('GET', '/tickets', { org: 'design' }) as S['SupportTicketPage'];
    expect(new Set([personal.items[0].id, company.items[0].id, personalOrg.items[0].id]).size).toBe(
      3
    );
    expect(() =>
      call('GET', '/tickets/{ticket}', { ticket: personal.items[0].id, org: 'acme-corp' })
    ).toThrow('support_not_found');
    expect(() => call('GET', '/tickets', { org: 'missing' })).toThrow('support_forbidden');
  });

  it('replays creates and replies exactly once and rejects a changed request key', () => {
    const { call } = setup();
    const key = randomUUID();
    const created = call('POST', '/tickets', { body: request, key }) as {
      __status: number;
      body: S['SupportSubmission'];
    };
    expect(created.__status).toBe(202);
    expect(call('POST', '/tickets', { body: request, key })).toEqual(created);
    expect(() =>
      call('POST', '/tickets', { body: { ...request, subject: 'Changed' }, key })
    ).toThrow('support_conflict');
    const ticket = created.body.ticket_id;
    const reply = {
      ticket,
      key: randomUUID(),
      body: { expected_revision: 1, body: 'More detail' },
    };
    const receipt = call('POST', '/tickets/{ticket}/messages', reply);
    expect(call('POST', '/tickets/{ticket}/messages', reply)).toEqual(receipt);
    expect(
      (call('GET', '/tickets/{ticket}/messages', { ticket }) as S['SupportMessagePage']).items
    ).toHaveLength(2);
    expect(() =>
      call('POST', '/tickets/{ticket}/close', { ticket, body: { expected_revision: 1 } })
    ).toThrow('support_conflict');
  });

  it('paginates messages and binds ratings to the resolved episode', () => {
    const { call } = setup();
    const created = call('POST', '/tickets', { body: request }) as { body: S['SupportSubmission'] };
    const ticket = created.body.ticket_id;
    for (let revision = 1; revision <= 51; revision++)
      call('POST', '/tickets/{ticket}/messages', {
        ticket,
        body: { expected_revision: revision, body: `Message ${revision}` },
      });
    const page = call('GET', '/tickets/{ticket}/messages', { ticket }) as S['SupportMessagePage'];
    expect(page.items).toHaveLength(50);
    const next = call('GET', '/tickets/{ticket}/messages', {
      ticket,
      query: `after=${page.next_cursor}`,
    }) as S['SupportMessagePage'];
    expect(next.items).toHaveLength(2);
    expect(next.next_cursor).toBeUndefined();
    call('POST', '/tickets/{ticket}/close', { ticket, body: { expected_revision: 52 } });
    const survey = call('GET', '/tickets/{ticket}/satisfaction', {
      ticket,
    }) as S['SupportSatisfaction'];
    call('POST', '/tickets/{ticket}/satisfaction', {
      ticket,
      body: { episode_id: survey.episode_id, rating: 5 },
    });
    expect(() =>
      call('POST', '/tickets/{ticket}/satisfaction', {
        ticket,
        body: { episode_id: survey.episode_id, rating: 4 },
      })
    ).toThrow('support_conflict');
    call('POST', '/tickets/{ticket}/reopen', {
      ticket,
      body: { expected_revision: 53, body: 'Still fails' },
    });
    expect(
      (call('GET', '/tickets/{ticket}/satisfaction', { ticket }) as S['SupportSatisfaction'])
        .episode_id
    ).not.toBe(survey.episode_id);
  });

  it('keeps later and other-ticket notifications unread without advancing the ticket revision', () => {
    const { call } = setup();
    const feed = call('GET', '/notifications') as S['SupportNotificationPage'];
    const earliest = feed.items.at(-1)!;
    const latest = feed.items[0];
    const before = call('GET', '/tickets/{ticket}', {
      ticket: earliest.ticket_id,
    }) as S['SupportTicket'];
    call('POST', '/tickets/{ticket}/read', {
      ticket: latest.ticket_id,
      body: { through_sequence: earliest.sequence },
    });
    expect((call('GET', '/notifications') as S['SupportNotificationPage']).unread_count).toBe(
      feed.unread_count
    );
    call('POST', '/tickets/{ticket}/read', {
      ticket: earliest.ticket_id,
      body: { through_sequence: earliest.sequence },
    });
    expect((call('GET', '/notifications') as S['SupportNotificationPage']).unread_count).toBe(
      feed.unread_count - 1
    );
    expect(
      (call('GET', '/tickets/{ticket}', { ticket: earliest.ticket_id }) as S['SupportTicket'])
        .revision
    ).toBe(before.revision);
  });
});
