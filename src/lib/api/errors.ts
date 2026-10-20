import type { components } from './schema';

/**
 * RFC 7807 error handling.
 *
 * Every failing route on this API answers with `application/problem+json` and
 * a stable machine-readable `code` — that is the field to branch on, never the
 * HTTP status and never the prose. `title` and `detail` are written for a
 * human and are safe to show; `code` is the contract.
 *
 * The one documented exception is the 429 from the auth rate limiter, which is
 * plain text (`pkg/middleware/authlimit.go`). `toApiError` synthesises a
 * Problem for it so callers never have to special-case a bare string.
 */

export type Problem = components['schemas']['Problem'];
export type FieldError = components['schemas']['FieldError'];

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: string;
  /** Per-field failures on a 422, shaped so a form can highlight inputs. */
  readonly fields: FieldError[];
  readonly problem: Problem;

  constructor(problem: Problem) {
    // `detail` is the specific sentence; `title` is the category. Prefer the
    // specific one for the message, since that is what reaches a toast.
    super(problem.detail || problem.title || problem.code);
    this.name = 'ApiError';
    this.status = problem.status;
    this.code = problem.code;
    this.detail = problem.detail;
    this.fields = problem.errors ?? [];
    this.problem = problem;
  }

  /** True when signing in again is the fix. */
  get isAuth(): boolean {
    return this.status === 401;
  }

  /** True when the caller is authenticated but not allowed. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** Retrying the exact same request may succeed. */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }

  /**
   * True when nothing coherent came back — the box is down, a proxy answered
   * for it, or the deploy is mid-restart.
   *
   * The tell is a synthesised code: `apid` answers every error it authors with
   * problem+json carrying a real `code`, so a `http_5xx` code means the body
   * was unparseable and no part of the API actually spoke. Worth separating
   * from a genuine server-side failure, because the two need different words
   * and only one of them is the user's problem.
   */
  get isUnreachable(): boolean {
    return this.status >= 500 && this.code.startsWith('http_');
  }

  /**
   * A 402 carries a link to whichever billing provider the box runs on, so the
   * UI can send the customer straight there instead of to a dead end:
   * `checkout_url` when a new subscription is needed, `billing_portal_url` when
   * an existing one must change, and the legacy Paddle field last.
   */
  get billingUrl(): string | undefined {
    return (
      this.problem.checkout_url ??
      this.problem.billing_portal_url ??
      this.problem.paddle_checkout_url
    );
  }
}

/** Fallback for a response that is not a Problem — a proxy error page, a bare 429. */
function synthesise(status: number, code: string, title: string, detail?: string): Problem {
  return { status, code, title, detail };
}

/**
 * Turns any failed `Response` into an `ApiError`.
 *
 * `openapi-fetch` hands back the parsed body when the content type is JSON, but
 * a gateway timeout or the plain-text 429 arrives as neither — so the body is
 * re-read defensively rather than assumed.
 */
export async function toApiError(response: Response, parsed?: unknown): Promise<ApiError> {
  const problem = asProblem(parsed) ?? asProblem(await readBody(response));

  if (problem) return new ApiError(problem);

  // Nothing parseable came back. The status is still meaningful, and the auth
  // limiter's plain-text 429 lands here by design.
  const code = response.status === 429 ? 'rate_limited' : `http_${response.status}`;
  return new ApiError(
    synthesise(
      response.status,
      code,
      response.statusText || 'Request failed',
      response.status === 429
        ? 'Too many attempts. Wait a minute and try again.'
        : response.status >= 500
          ? // Otherwise this surfaces as the gateway's own "Internal Server
            // Error", which reads as *your app* broke rather than the API
            // being unavailable.
            'Could not reach the API. It may be restarting.'
          : undefined
    )
  );
}

async function readBody(response: Response): Promise<unknown> {
  try {
    const text = await response.clone().text();
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

/** A Problem is only trustworthy if it carries the two fields we branch on. */
function asProblem(value: unknown): Problem | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<Problem>;
  if (typeof candidate.code !== 'string') return undefined;
  return {
    ...candidate,
    code: candidate.code,
    title: candidate.title ?? candidate.code,
    status: typeof candidate.status === 'number' ? candidate.status : 500,
  } as Problem;
}

/**
 * Message for a toast or an inline form error.
 *
 * Anything that is not an `ApiError` reaching here is a bug or a dropped
 * connection, and both read the same way to the person at the keyboard.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'secret_scan_strict' && error.problem.secret_findings?.length) {
      // Locations and detector names explain the rejection without copying
      // secret snippets into toasts or deployment recovery state.
      const findings = error.problem.secret_findings;
      const locations = findings
        .slice(0, 5)
        .map((finding) => `${finding.file}:${finding.line} (${finding.provider})`);
      return `${error.message} ${locations.join('; ')}${findings.length > 5 ? `; and ${findings.length - 5} more` : ''}.`;
    }
    return error.message;
  }
  if (error instanceof Error && error.name === 'AbortError') return 'Request cancelled.';
  if (error instanceof TypeError) return 'Could not reach the API. Check your connection.';
  return error instanceof Error ? error.message : 'Something went wrong.';
}
