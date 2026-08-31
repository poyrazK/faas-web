import { useEffect, useState } from 'react';

/**
 * The account-wide event stream — `gregale tail` for the browser.
 *
 * `/v1/events` is not in the OpenAPI spec (validated matrix, ticket T4), so
 * the frame shape is pinned here from the CLI's decoder
 * (`cmd/gregale/commands5.go:1283`) rather than generated: one JSON object
 * per frame with the invocation, the app, and the state it entered. The
 * CLI's `--app` filter is client-side, so the console filters client-side
 * too.
 */
export interface AccountEvent {
  invocation_id: string;
  app_id: string;
  app_slug: string;
  state: string;
  receivedAt: number;
}

export function parseAccountFrame(data: string, receivedAt: number): AccountEvent | null {
  try {
    const p = JSON.parse(data) as Partial<AccountEvent>;
    if (typeof p.invocation_id !== 'string' || typeof p.app_id !== 'string') return null;
    return {
      invocation_id: p.invocation_id,
      app_id: p.app_id,
      app_slug: p.app_slug ?? '',
      state: p.state ?? '',
      receivedAt,
    };
  } catch {
    return null;
  }
}

/** Newest first; older rows fall off the bottom. */
export const MAX_ACCOUNT_EVENTS = 500;

export type AccountStreamStatus = 'connecting' | 'streaming' | 'error';

export function useAccountEvents(connected = true): {
  events: AccountEvent[];
  status: AccountStreamStatus;
} {
  const [events, setEvents] = useState<AccountEvent[]>([]);
  const [status, setStatus] = useState<AccountStreamStatus>('connecting');

  useEffect(() => {
    if (!connected) return;
    const source = new EventSource('/v1/events', { withCredentials: true });
    const onFrame = (event: MessageEvent<string>) => {
      const row = parseAccountFrame(event.data ?? '', Date.now());
      if (!row) return;
      setStatus('streaming');
      setEvents((prev) => [row, ...prev].slice(0, MAX_ACCOUNT_EVENTS));
    };
    source.onmessage = onFrame;
    // EventSource reconnects on its own; surface the hiccup, keep the buffer.
    source.onerror = () => setStatus('error');
    source.onopen = () => setStatus('streaming');
    return () => source.close();
  }, [connected]);

  return { events, status };
}
