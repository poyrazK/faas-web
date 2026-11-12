import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { components } from '../src/lib/api/schema';
import { EMPTY, orgs } from './data';

type S = components['schemas'];
type Context = {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  req: Pick<IncomingMessage, 'headers'>;
};
type Register = (method: string, template: string, handler: (ctx: Context) => unknown) => void;
type ProblemCtor = new (status: number, code: string, detail?: string) => Error;
type Conversation = {
  ticket: S['SupportTicket'];
  messages: S['SupportMessage'][];
  survey: S['SupportSatisfaction'];
  notices: S['SupportNotification'][];
};

/** A stateful, scoped mock of the public contract. Never imported by src/. */
export function registerSupportMocks(route: Register, Problem: ProblemCtor) {
  const scopes = new Map<string, Conversation[]>();
  const receipts = new Map<string, { fingerprint: string; result: unknown }>();
  let sequence = 0;
  const now = () => new Date().toISOString();
  const fail = (code: string, detail: string, status = 409): never => {
    throw new Problem(status, code, detail);
  };
  const text = (value: unknown, max: number) =>
    typeof value === 'string' &&
    value.trim() &&
    !value.includes('\0') &&
    Buffer.byteLength(value) <= max;
  const addMessage = (
    conversation: Conversation,
    body: string,
    author: 'customer' | 'staff' = 'customer'
  ) => {
    conversation.messages.push({
      id: randomUUID(),
      sequence: ++sequence,
      body,
      author,
      redacted: false,
      created_at: now(),
    });
  };
  function collection(org?: string) {
    if (org && !orgs.some((o) => o.slug === org))
      fail('support_forbidden', 'Organization support is unavailable.', 403);
    const key = org ?? 'personal';
    if (!scopes.has(key)) {
      const seeded: Conversation[] = EMPTY
        ? []
        : (['pending', 'open', 'resolved'] as const).map((status, index) => {
            const ticket: S['SupportTicket'] = {
              id: randomUUID(),
              subject: [
                'Help with a deployment that keeps restarting',
                'A question about this month’s usage',
                'Connecting a custom domain',
              ][index],
              category: index === 1 ? 'billing' : 'deployment',
              status,
              revision: 3,
              context: {},
              created_at: now(),
              updated_at: now(),
              can_reopen: status === 'resolved',
              ...(status === 'resolved'
                ? {
                    resolved_at: now(),
                    reopen_until: new Date(Date.now() + 7 * 86_400_000).toISOString(),
                  }
                : {}),
            };
            const row: Conversation = {
              ticket,
              messages: [],
              survey: { episode_id: randomUUID(), eligible: status === 'resolved' },
              notices: [],
            };
            addMessage(
              row,
              [
                'My app starts, but the health check does not pass. What should I check?',
                'Could you help me understand the compute usage on my invoice?',
                'I need help connecting my custom domain.',
              ][index]
            );
            if (index !== 1) {
              addMessage(
                row,
                index === 0
                  ? 'Please check that your app listens on 0.0.0.0 and uses the configured port. Which framework are you deploying?'
                  : 'Your domain is now connected. Let us know if you need anything else.',
                'staff'
              );
              row.notices.push({
                id: randomUUID(),
                sequence: ++sequence,
                ticket_id: ticket.id,
                kind: 'staff_reply',
                created_at: now(),
              });
            }
            return row;
          });
      scopes.set(key, seeded);
    }
    return scopes.get(key)!;
  }
  function find(ctx: Context) {
    return (
      collection(ctx.params.org).find((item) => item.ticket.id === ctx.params.ticket) ??
      fail('support_not_found', 'Conversation not found in this workspace.', 404)
    );
  }
  const unread = (row: Conversation) => row.notices.filter((n) => !n.read_at).length;
  const view = (row: Conversation) => ({ ...row.ticket, unread_count: unread(row) });
  function write(ctx: Context, operation: string, apply: () => unknown) {
    const key = ctx.req.headers['idempotency-key'];
    if (typeof key !== 'string' || !/^[a-f\d-]{36}$/i.test(key))
      fail('support_invalid', 'A UUID request key is required.', 400);
    const fingerprint = JSON.stringify([
      ctx.params.org ?? 'personal',
      ctx.params.ticket,
      operation,
      ctx.body,
    ]);
    const old = receipts.get(key as string);
    if (old)
      return old.fingerprint === fingerprint
        ? old.result
        : fail('support_conflict', 'This key belongs to another request.');
    const result = { __status: 202, body: apply() };
    receipts.set(key as string, { fingerprint, result });
    return result;
  }
  for (const prefix of ['/v1/support', '/v1/orgs/{org}/support']) {
    route('GET', `${prefix}/tickets`, (ctx) => {
      const search = ctx.query.get('search')?.toLowerCase() ?? '';
      const status = ctx.query.get('status');
      const rows = collection(ctx.params.org).filter(
        (row) =>
          (!status || row.ticket.status === status) &&
          (row.ticket.subject.toLowerCase().includes(search) ||
            row.messages.some((m) => m.body.toLowerCase().includes(search)))
      );
      const cursor = ctx.query.get('cursor');
      const start = cursor ? rows.findIndex((row) => row.ticket.id === cursor) + 1 : 0;
      const items = rows.slice(start, start + 50);
      return {
        items: items.map(view),
        ...(rows.length > start + 50 ? { next_cursor: items.at(-1)!.ticket.id } : {}),
      } satisfies S['SupportTicketPage'];
    });
    route('POST', `${prefix}/tickets`, (ctx) =>
      write(ctx, 'create', () => {
        const body = ctx.body as S['CreateSupportTicketRequest'];
        if (
          !text(body.subject, 200) ||
          !text(body.body, 10_000) ||
          !['deployment', 'billing', 'account', 'incident', 'other'].includes(body.category)
        )
          fail('support_invalid', 'A valid subject, topic and message are required.', 400);
        const ticket: S['SupportTicket'] = {
          id: randomUUID(),
          subject: body.subject,
          category: body.category,
          status: 'open',
          revision: 1,
          context: body.context ?? {},
          created_at: now(),
          updated_at: now(),
          can_reopen: false,
        };
        const row: Conversation = {
          ticket,
          messages: [],
          notices: [],
          survey: { episode_id: randomUUID(), eligible: false },
        };
        addMessage(row, body.body);
        collection(ctx.params.org).unshift(row);
        return {
          ticket_id: ticket.id,
          submission_id: randomUUID(),
          revision: 1,
        } satisfies S['SupportSubmission'];
      })
    );
    route('GET', `${prefix}/tickets/{ticket}`, (ctx) => view(find(ctx)));
    route('GET', `${prefix}/tickets/{ticket}/messages`, (ctx) => {
      const rows = find(ctx).messages.filter(
        (m) => m.sequence > Number(ctx.query.get('after') ?? 0)
      );
      return {
        items: rows.slice(0, 50),
        ...(rows.length > 50 ? { next_cursor: rows[49].sequence } : {}),
      } satisfies S['SupportMessagePage'];
    });
    for (const operation of ['messages', 'close', 'reopen']) {
      route('POST', `${prefix}/tickets/{ticket}/${operation}`, (ctx) =>
        write(ctx, operation, () => {
          const row = find(ctx);
          if (ctx.body.expected_revision !== row.ticket.revision)
            fail('support_conflict', 'Load the latest conversation.');
          const resolved = row.ticket.status === 'resolved';
          if (operation === 'reopen' ? !resolved || !row.ticket.can_reopen : resolved)
            fail('support_conflict', 'The conversation status changed.');
          if (operation !== 'close') {
            if (!text(ctx.body.body, 10_000))
              fail('support_invalid', 'A message is required (at most 10,000 bytes).', 400);
            addMessage(row, ctx.body.body as string);
          }
          row.ticket.status = operation === 'close' ? 'resolved' : 'open';
          row.ticket.updated_at = now();
          row.ticket.revision++;
          row.ticket.can_reopen = operation === 'close';
          row.survey.eligible = operation === 'close';
          if (operation === 'close') {
            row.ticket.resolved_at = now();
            row.ticket.reopen_until = new Date(Date.now() + 7 * 86_400_000).toISOString();
          }
          if (operation === 'reopen') {
            delete row.ticket.resolved_at;
            delete row.ticket.reopen_until;
            row.survey = { episode_id: randomUUID(), eligible: false };
          }
          return {
            ticket_id: row.ticket.id,
            submission_id: randomUUID(),
            revision: row.ticket.revision,
          } satisfies S['SupportSubmission'];
        })
      );
    }
    route('GET', `${prefix}/tickets/{ticket}/satisfaction`, (ctx) => find(ctx).survey);
    route('POST', `${prefix}/tickets/{ticket}/satisfaction`, (ctx) =>
      write(ctx, 'rate', () => {
        const row = find(ctx);
        if (!row.survey.eligible || ctx.body.episode_id !== row.survey.episode_id)
          fail('support_conflict', 'This resolution can no longer be rated.');
        const rating = Number(ctx.body.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5)
          fail('support_invalid', 'Choose a rating from 1 to 5.', 400);
        row.survey = { ...row.survey, eligible: false, rating };
        return {
          episode_id: row.survey.episode_id,
          rating,
        } satisfies S['SupportSatisfactionSubmission'];
      })
    );
    route('GET', `${prefix}/notifications`, (ctx) => {
      const all = collection(ctx.params.org).flatMap((row) => row.notices);
      const before = Number(ctx.query.get('before') ?? Infinity);
      const rows = all
        .filter((n) => n.sequence < before && (ctx.query.get('unread') !== 'true' || !n.read_at))
        .sort((a, b) => b.sequence - a.sequence);
      return {
        items: rows.slice(0, 50),
        ...(rows.length > 50 ? { next_cursor: rows[49].sequence } : {}),
        unread_count: all.filter((n) => !n.read_at).length,
      } satisfies S['SupportNotificationPage'];
    });
    route('POST', `${prefix}/tickets/{ticket}/read`, (ctx) => {
      const row = find(ctx);
      const through = Number(ctx.body.through_sequence);
      if (!Number.isInteger(through) || through < 1)
        fail('support_invalid', 'An observed sequence is required.', 400);
      for (const notice of row.notices)
        if (notice.sequence <= through && !notice.read_at) notice.read_at = now();
      return {
        __status: 202,
        body: {
          ticket_id: row.ticket.id,
          unread_count: unread(row),
          unread_total: collection(ctx.params.org).reduce((total, item) => total + unread(item), 0),
        } satisfies S['SupportReadResult'],
      };
    });
  }
}
