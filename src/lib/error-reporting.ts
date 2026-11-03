import { ApiError } from './api/errors';

/**
 * Browser error reporting, behind `featureFlags.errorReporting` (off).
 *
 * Until now an uncaught error, an unhandled rejection, or a route that threw
 * into `RouteError` went nowhere: the person saw a panel, and nobody else knew.
 * This captures each of them once, strips what a report must never carry, and
 * hands it to a transport.
 *
 * **The transport is a no-op on purpose.** Where reports go is the owner's
 * call, not this module's:
 * - Gregale Issues, with a public ingest token in the bundle
 *   (`/v1/apps/{slug}/issue-ingest-tokens` is per app);
 * - a first-party apid endpoint, which needs a backend change;
 * - a third-party host, which needs a CSP `connect-src` origin that
 *   `security-headers.ts` deliberately does not grant.
 *
 * Until one is chosen, `setErrorTransport` is the seam and nothing leaves the
 * page. With the flag off, nothing here is even in the bundle.
 */

export type ErrorSource = 'error' | 'unhandledrejection' | 'route';

export interface ErrorReport {
  /** Lets a receiver tell these apart from other reports; also how the bundle test finds this code. */
  schema: typeof REPORT_SCHEMA;
  source: ErrorSource;
  name: string;
  message: string;
  stack?: string;
  /** The console path, without its query string or fragment. */
  path: string;
  /** ISO 8601, from the browser's clock. */
  at: string;
}

export interface ErrorTransport {
  send(report: ErrorReport): void;
}

export const REPORT_SCHEMA = 'gregale.console-error/1';

/** One page can loop on an error; a session never sends more than this. */
export const MAX_REPORTS_PER_SESSION = 20;

const MAX_FIELD_LENGTH = 2000;

const noopTransport: ErrorTransport = { send: () => {} };

let transport: ErrorTransport = noopTransport;
let sent = 0;
const seen = new Set<string>();

/** Where reports go. `null` restores the no-op. */
export function setErrorTransport(next: ErrorTransport | null) {
  transport = next ?? noopTransport;
}

/** Forgets the session's de-duplication and cap. For tests. */
export function resetErrorReporting() {
  transport = noopTransport;
  sent = 0;
  seen.clear();
}

/**
 * Removes what a report must never carry.
 *
 * Query strings and fragments go from every URL, absolute or relative: that is
 * where log searches, OAuth codes and invitation tokens travel. Email addresses
 * keep only their domain. Bearer and Basic credentials, and any long opaque
 * token (keys, session ids, UUIDs), become `[redacted]`.
 */
export function redact(text: string): string {
  return text
    .replace(/(https?:\/\/[^\s?#"'`]+)[?#][^\s"'`]*/g, '$1')
    .replace(/((?:^|[\s("'`])\/[\w\-./~%]*)[?#][^\s"'`)]*/g, '$1')
    .replace(/[\w.+-]+@((?:[\w-]+\.)+[\w-]{2,})/g, '…@$1')
    .replace(/\b(Bearer|Basic)\s+[\w\-.~+/=]+/gi, '$1 [redacted]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]')
    .slice(0, MAX_FIELD_LENGTH);
}

function describe(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error)
    return { name: error.name, message: error.message, stack: error.stack };
  if (typeof error === 'string') return { name: 'Error', message: error };
  try {
    return { name: 'NonError', message: JSON.stringify(error) ?? String(error) };
  } catch {
    return { name: 'NonError', message: String(error) };
  }
}

/**
 * A 4xx `ApiError` is a settled answer the page already explains (not found,
 * forbidden, a validation failure), not a defect. A 5xx or an unreachable API
 * still is.
 */
function isExpected(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

function currentPath(): string {
  return typeof window === 'undefined' ? '' : window.location.pathname;
}

/**
 * Reports `error` once per session. Returns whether it was handed to the
 * transport: false when it is expected, already reported, or over the cap.
 * Never throws, whatever the transport does.
 */
export function reportError(source: ErrorSource, error: unknown, path = currentPath()): boolean {
  if (isExpected(error) || sent >= MAX_REPORTS_PER_SESSION) return false;
  const { name, message, stack } = describe(error);
  const report: ErrorReport = {
    schema: REPORT_SCHEMA,
    source,
    name: redact(name).slice(0, 200),
    message: redact(message),
    ...(stack ? { stack: redact(stack) } : {}),
    path: path.split(/[?#]/)[0],
    at: new Date().toISOString(),
  };
  // The first stack frame tells one call site from another with the same message.
  const key = [source, report.name, report.message, report.stack?.split('\n')[1] ?? ''].join('|');
  if (seen.has(key)) return false;
  seen.add(key);
  sent += 1;
  try {
    transport.send(report);
  } catch {
    // A reporter that throws would turn one error into two.
  }
  return true;
}

/** Listens for what nothing else catches. Returns the uninstaller. */
export function installErrorReporting(target: Window = window): () => void {
  const onError = (event: ErrorEvent) => {
    reportError('error', event.error ?? event.message);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    reportError('unhandledrejection', event.reason);
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
