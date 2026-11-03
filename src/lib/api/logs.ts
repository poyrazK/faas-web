import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogLevel } from '@/lib/mock-data';
import { ApiError, toApiError } from './errors';

/**
 * The console's log streams, over Server-Sent Events.
 *
 * Three endpoints answer in the same SSE shape and so share this hook: an
 * app's logs (`/v1/apps/{slug}/logs`, live or read back from the archive), a
 * build's (`/v1/deployments/{id}/logs`), and a job task's live output
 * (`/v1/jobs/{name}/runs/{id}/tasks/{idx}/logs/stream`, served by the compute
 * gateway on the same origin). Each emits `event: log` per line and a
 * terminal `event: end`, whose data is `{"reason": …}` (apislogs/sse.go:17)
 * or, from older producers, the bare reason.
 *
 * Deliberately not `openapi-fetch` and not TanStack Query — this is a held-open
 * connection, not a request.
 */

/** The levels the API filters on. `debug` arrives in frames but is not a filter. */
export const LOG_LEVELS = ['info', 'warn', 'error'] as const;
export type LogLevelFilter = (typeof LOG_LEVELS)[number];

export interface LogLine {
  id: string;
  /** When the console saw it, or the frame's own timestamp when it carries one. */
  ts: number;
  level?: LogLevel;
  instanceId?: string;
  /** The message, once the envelope is off. */
  text: string;
  /** The frame exactly as it arrived, for copy and download. */
  raw: string;
}

export type StreamStatus =
  'idle' | 'connecting' | 'reconnecting' | 'streaming' | 'paused' | 'ended' | 'error';

/** Five attempts per outage; a healthy connection resets the budget. */
const RETRY_DELAYS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;

/**
 * Where the lines come from.
 *
 * A discriminated union rather than a pile of optional parameters, because the
 * API's own rules are per mode: archive *requires* an instance and a date,
 * live ignores both, and a build stream has neither.
 */
export type StreamSource =
  | { kind: 'live'; slug: string; grep?: string; level?: LogLevelFilter | ''; since?: string }
  | {
      kind: 'archive';
      slug: string;
      instance: string;
      date: string;
      grep?: string;
      level?: LogLevelFilter | '';
    }
  | { kind: 'build'; deploymentId: string; limit?: number }
  /** One task of a job run: waits while queued, then follows each attempt in turn. */
  | { kind: 'task'; job: string; runId: string; index: number };

/** How many lines are kept. Older ones fall off the top, and the UI says so. */
export const MAX_LINES = 2000;

const LEVELS = new Set<LogLevel>(['info', 'warn', 'error', 'debug']);

function asLevel(value: unknown): LogLevel | undefined {
  if (typeof value !== 'string') return undefined;
  const lower = value.toLowerCase();
  if (LEVELS.has(lower as LogLevel)) return lower as LogLevel;
  // Common aliases from structured loggers.
  if (lower === 'warning') return 'warn';
  if (lower === 'err' || lower === 'fatal' || lower === 'panic') return 'error';
  return undefined;
}

function asTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return ms;
  }
  return undefined;
}

/**
 * Turn one SSE frame into a line.
 *
 * The spec documents the stream as *structured* and names a `level` field and
 * an `instance_id` field, but never gives the frame's schema. So this parses
 * defensively: JSON when it is JSON, using whichever of the known fields are
 * present, and the raw string when it is not. A frame this does not understand
 * still renders as a line rather than disappearing.
 */
/**
 * ANSI escape sequences mean colours in a terminal and garbage in a `<p>`.
 * Stripped at parse time, once per line; `raw` keeps the original bytes so
 * copy and download reproduce what the app actually wrote. Covers CSI (the
 * colour/cursor family) and OSC-with-BEL (terminal titles); built with the
 * constructor so no control character sits in a regex literal.
 */
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_PATTERN = new RegExp(`${ESC}(?:\\[[0-9;?]*[ -/]*[@-~]|\\][^${BEL}]*${BEL})`, 'g');

export function stripAnsi(value: string): string {
  return value.includes(ESC) ? value.replace(ANSI_PATTERN, '') : value;
}

export function parseFrame(data: string, id: string, receivedAt: number): LogLine {
  const raw = data ?? '';
  const trimmed = raw.trim();

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const message =
        [parsed.msg, parsed.message, parsed.text, parsed.line, parsed.log].find(
          (v) => typeof v === 'string'
        ) ?? raw;
      return {
        id,
        ts:
          asTimestamp(parsed.ts ?? parsed.time ?? parsed.timestamp ?? parsed.written_at) ??
          receivedAt,
        level: asLevel(parsed.level ?? parsed.severity),
        instanceId:
          typeof parsed.instance_id === 'string'
            ? parsed.instance_id
            : typeof parsed.instance === 'string'
              ? parsed.instance
              : undefined,
        text: stripAnsi(String(message)),
        raw,
      };
    } catch {
      // Structured-looking but not parseable: fall through and show it whole.
    }
  }

  return { id, ts: receivedAt, level: levelFromText(raw), text: stripAnsi(raw), raw };
}

/**
 * A last resort for plain-text streams: read the level out of the line when it
 * is written in the usual way. Better than colouring nothing.
 */
function levelFromText(line: string): LogLevel | undefined {
  const m = /\b(INFO|WARN|WARNING|ERROR|DEBUG|FATAL|PANIC)\b/.exec(line);
  return m ? asLevel(m[1]) : undefined;
}

/** The URL and the identity of a subscription. */
function describe(source: StreamSource): { url: string; key: string } {
  if (source.kind === 'task') {
    const path = [source.job, source.runId, String(source.index)].map(encodeURIComponent);
    return {
      url: `/v1/jobs/${path[0]}/runs/${path[1]}/tasks/${path[2]}/logs/stream`,
      key: `task|${source.job}|${source.runId}|${source.index}`,
    };
  }
  if (source.kind === 'build') {
    const params = new URLSearchParams({ follow: '1' });
    if (source.limit) params.set('limit', String(source.limit));
    return {
      url: `/v1/deployments/${encodeURIComponent(source.deploymentId)}/logs?${params}`,
      key: `build|${source.deploymentId}|${source.limit ?? ''}`,
    };
  }

  const params = new URLSearchParams();
  if (source.grep?.trim()) params.set('grep', source.grep.trim());
  if (source.level) params.set('level', source.level);

  if (source.kind === 'archive') {
    params.set('archive', '1');
    params.set('instance', source.instance);
    params.set('date', source.date);
  } else {
    params.set('follow', '1');
    if (source.since) params.set('since', source.since);
  }

  return {
    url: `/v1/apps/${encodeURIComponent(source.slug)}/logs?${params}`,
    key: `${source.kind}|${source.slug}|${params.toString()}`,
  };
}

function ready(source: StreamSource): boolean {
  if (source.kind === 'task')
    return (
      Boolean(source.job && source.runId) && Number.isInteger(source.index) && source.index >= 0
    );
  if (source.kind === 'build') return Boolean(source.deploymentId);
  if (source.kind === 'archive') return Boolean(source.slug && source.instance && source.date);
  return Boolean(source.slug);
}

interface StreamState {
  key: string;
  lines: LogLine[];
  status: StreamStatus;
  /** The archive's refusal, when there is one — 402 and 403 both land here. */
  error?: unknown;
  /** `archive_complete`, `archive_missing`, `archive_degraded`, or an error code. */
  reason?: string;
  /** True once the ring buffer has dropped a line, so the UI can say so. */
  truncated: boolean;
  /** `event: gap` frames: output the producer had already dropped before relaying it. */
  gaps?: number;
}

const EMPTY: StreamState = { key: '', lines: [], status: 'idle', truncated: false };

/** The end frame's reason: `{"reason":"…"}`, `{}`, or a bare word from older producers. */
function endReason(data: string | undefined): string | undefined {
  const trimmed = data?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { reason?: unknown };
      return typeof parsed.reason === 'string' && parsed.reason ? parsed.reason : undefined;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

/** A task stream's line sequence, to resume after a dropped connection. */
function frameSeq(data: string): number | undefined {
  const match = /"seq"\s*:\s*(\d+)/.exec(data);
  return match ? Number(match[1]) : undefined;
}

/**
 * Subscribe to a log stream.
 *
 * `connected` is the pause switch, and it is deliberately *not* part of the
 * subscription key: pausing closes the connection and keeps the buffer, so you
 * can stop on a line and still read it. Keying on it — which this hook used to
 * do — emptied the screen the moment you pressed Pause.
 */
/**
 * Read a finished archive over `fetch` rather than `EventSource`.
 *
 * The archive is a bounded response, not a held-open stream, and both of its
 * refusals are HTTP: 402 when the plan has no archive, 403 when the date falls
 * outside the retention window. `EventSource` exposes neither — its `onerror`
 * cannot tell a 402 from a dropped connection — so the one mode that has real
 * status codes to report is the one that does not use it.
 */
async function fetchArchive(url: string, signal: AbortSignal) {
  const res = await fetch(url, { credentials: 'include', signal });
  if (!res.ok) throw await toApiError(res);

  const body = await res.text();
  const lines: LogLine[] = [];
  let reason: string | undefined;
  let seq = 0;

  // SSE framing, read whole: blank-line-separated records of `event:`/`data:`.
  for (const frame of body.split('\n\n')) {
    let event = 'message';
    const data: string[] = [];
    for (const raw of frame.split('\n')) {
      if (raw.startsWith('event:')) event = raw.slice(6).trim();
      else if (raw.startsWith('data:')) data.push(raw.slice(5).replace(/^ /, ''));
    }
    if (!data.length && event === 'message') continue;
    const payload = data.join('\n');
    if (event === 'log') lines.push(parseFrame(payload, `a${seq++}`, Date.now()));
    else if (event === 'end') reason = endReason(payload);
  }
  return { lines, reason };
}

export function useLogStream(source: StreamSource, connected = true) {
  const [state, setState] = useState<StreamState>(EMPTY);
  const counter = useRef(0);
  const [restart, setRestart] = useState(0);

  const enabled = ready(source);
  const isArchive = source.kind === 'archive';
  const resumable = source.kind === 'task';
  const { url, key } = enabled ? describe(source) : { url: '', key: '' };

  useEffect(() => {
    if (!key || !connected) return;

    if (isArchive) {
      const controller = new AbortController();
      // No "connecting" set here: the read below already reports it whenever
      // the state's key differs from the subscription's, and setting it
      // synchronously in an effect only costs a render.
      void fetchArchive(url, controller.signal)
        .then(({ lines, reason }) => {
          if (!controller.signal.aborted) {
            setState({ key, lines, status: 'ended', reason, truncated: false });
          }
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setState({
            key,
            lines: [],
            status: 'error',
            reason: err instanceof ApiError ? err.code : undefined,
            error: err,
            truncated: false,
          });
        });
      return () => controller.abort();
    }

    let disposed = false;
    let current: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    // A task stream resumes the attempt after the last relayed line; the
    // cursor is an inclusive lower bound (vmmdgrpc/logs.go), hence the + 1.
    let lastSeq = 0;

    const update = (fn: (prev: StreamState) => StreamState) => {
      if (disposed) return;
      setState((prev) => fn(prev.key === key ? prev : { ...EMPTY, key, status: 'connecting' }));
    };

    const connect = () => {
      if (disposed) return;
      const target = resumable && lastSeq > 0 ? `${url}?since_seq=${lastSeq + 1}` : url;
      const connection = new EventSource(target, { withCredentials: true });
      current = connection;
      // A retired connection can still deliver queued callbacks. Only the
      // current connection may update this subscription or schedule a retry.
      const active = () => !disposed && current === connection;
      const retire = () => {
        current = undefined;
        connection.close();
      };

      connection.onopen = () => {
        if (!active()) return;
        attempts = 0;
        update((prev) => ({ ...prev, status: 'streaming', reason: undefined, error: undefined }));
      };
      connection.addEventListener('log', (event) => {
        if (!active()) return;
        const data = (event as MessageEvent<string>).data ?? '';
        if (resumable) lastSeq = frameSeq(data) ?? lastSeq;
        update((prev) => {
          const line = parseFrame(data, `l${counter.current++}`, Date.now());
          const next = [...prev.lines, line];
          const over = next.length > MAX_LINES;
          return {
            key,
            status: 'streaming',
            gaps: prev.gaps,
            truncated: prev.truncated || over,
            lines: over ? next.slice(next.length - MAX_LINES) : next,
          };
        });
      });
      connection.addEventListener('gap', () => {
        if (!active()) return;
        update((prev) => ({ ...prev, gaps: (prev.gaps ?? 0) + 1 }));
      });
      connection.addEventListener('end', (event) => {
        if (!active()) return;
        const reason = endReason((event as MessageEvent<string>).data);
        retire();
        update((prev) => ({ ...prev, status: 'ended', reason }));
      });
      connection.onerror = (event) => {
        if (!active()) return;
        retire();
        // Named SSE error frames carry a server refusal. Transport errors
        // have no data; retrying a bad parameter would repeat it forever.
        const reason = (event as MessageEvent<string>).data?.trim();
        if (reason) {
          update((prev) => ({ ...prev, status: 'error', reason }));
          return;
        }
        const delay = RETRY_DELAYS[attempts++];
        if (delay === undefined) {
          update((prev) => ({ ...prev, status: 'error', reason: undefined }));
          return;
        }
        update((prev) => ({ ...prev, status: 'reconnecting', reason: undefined }));
        timer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      current?.close();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [key, url, connected, isArchive, resumable, restart]);

  const clear = useCallback(() => {
    setState((prev) => ({ ...prev, lines: [], truncated: false }));
  }, []);

  const retry = useCallback(() => {
    if (!enabled || !connected || isArchive) return;
    setState((prev) => ({
      ...(prev.key === key ? prev : EMPTY),
      key,
      status: 'connecting',
      reason: undefined,
      error: undefined,
    }));
    setRestart((value) => value + 1);
  }, [enabled, connected, isArchive, key]);

  const visible = !enabled
    ? EMPTY
    : state.key !== key
      ? { ...EMPTY, status: (connected ? 'connecting' : 'idle') as StreamStatus }
      : { ...state, status: connected ? state.status : ('paused' as StreamStatus) };

  return {
    ...visible,
    canRetry: !isArchive && connected && visible.status === 'error' && !visible.reason,
    clear,
    retry,
  };
}
