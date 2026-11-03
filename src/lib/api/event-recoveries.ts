import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { eventsKey } from './events';

/**
 * Submitting the recovery actions a receipt lists.
 *
 * A receipt names each action as a method, a URL and sometimes a body
 * (faas appevents/receipts.go `eventReceiptActions`). The console never
 * fetches that URL blindly: it matches it to one of the four operations the
 * receipt can point at and calls that operation through the typed client, so
 * a URL outside the spec is simply not offered.
 */

type S = components['schemas'];
export type RecoveryAction = S['EventReceiptRecoveryAction'];

export type RecoveryTarget =
  | { op: 'routing_replay'; slug: string; body: S['ReplayEventFanoutFailureRequest'] }
  | { op: 'handler_replay' | 'keyed_handler_replay'; id: string }
  | { op: 'dead_letter_replay'; slug: string; id: string };

const ROUTING = /^\/v1\/apps\/([^/?#]+)\/event-deliveries:replay-fanout-failure$/;
const HANDLER = /^\/v1\/invocations\/([^/?#]+)\/replay$/;
const KEYED = /^\/v1\/invocations\/([^/?#]+)\/replay-keyed$/;
const DEAD_LETTER = /^\/v1\/apps\/([^/?#]+)\/dlq\/([^/?#]+)\/replay$/;

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

/** The typed operation an action names, or null when it is not one the console can submit. */
export function recoveryTarget(action: RecoveryAction): RecoveryTarget | null {
  if (action.method !== 'POST') return null;
  const url = action.url;
  let match: RegExpMatchArray | null;
  if (action.kind === 'routing_replay' && (match = url.match(ROUTING)) && action.body) {
    const slug = decode(match[1]);
    return slug ? { op: 'routing_replay', slug, body: action.body } : null;
  }
  if (action.kind === 'handler_replay' && (match = url.match(HANDLER))) {
    const id = decode(match[1]);
    return id ? { op: 'handler_replay', id } : null;
  }
  if (action.kind === 'keyed_handler_replay' && (match = url.match(KEYED))) {
    const id = decode(match[1]);
    return id ? { op: 'keyed_handler_replay', id } : null;
  }
  if (action.kind === 'dead_letter_replay' && (match = url.match(DEAD_LETTER))) {
    const slug = decode(match[1]);
    const id = decode(match[2]);
    return slug && id ? { op: 'dead_letter_replay', slug, id } : null;
  }
  return null;
}

function submit(target: RecoveryTarget, key: string): Promise<unknown> {
  switch (target.op) {
    case 'routing_replay':
      return unwrap(
        api.POST('/v1/apps/{slug}/event-deliveries:replay-fanout-failure', {
          params: { path: { slug: target.slug }, header: { 'Idempotency-Key': key } },
          body: target.body,
        })
      );
    case 'handler_replay':
      return unwrap(
        api.POST('/v1/invocations/{id}/replay', { params: { path: { id: target.id } } })
      );
    case 'keyed_handler_replay':
      return unwrap(
        api.POST('/v1/invocations/{id}/replay-keyed', { params: { path: { id: target.id } } })
      );
    case 'dead_letter_replay':
      return unwrap(
        api.POST('/v1/apps/{slug}/dlq/{id}/replay', {
          params: {
            path: { slug: target.slug, id: target.id },
            header: { 'Idempotency-Key': key },
          },
        })
      );
  }
}

/**
 * Submits one recovery. The key is minted once per confirmed action, so a
 * retried request returns the first answer instead of queuing twice; the
 * receipt is read again afterwards, since the recipient's state moved.
 */
export function useSubmitRecovery(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ target, key = crypto.randomUUID() }: { target: RecoveryTarget; key?: string }) =>
      submit(target, key),
    onSettled: () => qc.invalidateQueries({ queryKey: eventsKey(accountId) }),
  });
}
