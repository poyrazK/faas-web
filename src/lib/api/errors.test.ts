import { describe, expect, it } from 'vitest';
import { ApiError, errorMessage, toApiError } from './errors';

/**
 * The error path is the part of an API client that only runs when something is
 * already wrong, so it is the part least likely to be exercised by hand. These
 * cover the shapes `apid` actually returns — including the one documented
 * endpoint that does not return a Problem at all.
 */

function problemResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

describe('toApiError', () => {
  it('shows secret finding locations without including credential snippets', () => {
    const error = new ApiError({
      code: 'secret_scan_strict',
      status: 422,
      title: 'Source contains a possible secret',
      secret_findings: [
        {
          file: 'scripts/smoke.sh',
          line: 40,
          provider: 'high_entropy',
          severity: 'medium',
          snippet: 'DO_NOT_DISPLAY',
        },
      ],
    });
    expect(errorMessage(error)).toContain('scripts/smoke.sh:40 (high_entropy)');
    expect(errorMessage(error)).not.toContain('DO_NOT_DISPLAY');
  });
  it('reads the stable code out of an RFC 7807 body', async () => {
    const error = await toApiError(
      problemResponse(401, {
        type: '',
        title: 'Sign in failed',
        status: 401,
        code: 'invalid_credentials',
        detail: 'email or password is incorrect.',
      })
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('invalid_credentials');
    expect(error.status).toBe(401);
    expect(error.isAuth).toBe(true);
  });

  it('prefers detail over title for the message, since detail is the specific one', async () => {
    const error = await toApiError(
      problemResponse(422, {
        title: 'Validation failed',
        status: 422,
        code: 'validation_failed',
        detail: 'slug must be lowercase',
      })
    );

    expect(error.message).toBe('slug must be lowercase');
  });

  it('falls back to the title when there is no detail', async () => {
    const error = await toApiError(
      problemResponse(409, { title: 'Already exists', status: 409, code: 'conflict' })
    );

    expect(error.message).toBe('Already exists');
  });

  it('keeps field errors so a form can mark the offending input', async () => {
    const error = await toApiError(
      problemResponse(422, {
        title: 'Validation failed',
        status: 422,
        code: 'validation_failed',
        errors: [{ field: 'slug', expected: 'lowercase', got: 'Hello' }],
      })
    );

    expect(error.fields).toHaveLength(1);
    expect(error.fields[0].field).toBe('slug');
  });

  it('synthesises a Problem for the auth limiter, which answers in plain text', async () => {
    // Documented exception in the spec: pkg/middleware/authlimit.go returns a
    // bare string, not application/problem+json.
    const response = new Response('too many requests', {
      status: 429,
      headers: { 'content-type': 'text/plain' },
    });

    const error = await toApiError(response);

    expect(error.code).toBe('rate_limited');
    expect(error.status).toBe(429);
    expect(error.isRetryable).toBe(true);
  });

  it('does not mistake an arbitrary JSON body for a Problem', async () => {
    // A proxy or an error page can return JSON that has nothing to do with the
    // API contract. Without a `code` it is not a Problem.
    const response = new Response(JSON.stringify({ message: 'gateway exploded' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });

    const error = await toApiError(response);

    expect(error.code).toBe('http_502');
    expect(error.isRetryable).toBe(true);
  });

  it('treats 4xx other than 429 as settled rather than retryable', async () => {
    const error = await toApiError(
      problemResponse(404, { title: 'Not found', status: 404, code: 'not_found' })
    );

    expect(error.isRetryable).toBe(false);
    expect(error.isNotFound).toBe(true);
  });

  it('surfaces whichever billing provider the 402 names', async () => {
    const stripe = await toApiError(
      problemResponse(402, {
        title: 'Payment required',
        status: 402,
        code: 'payment_required',
        billing_portal_url: 'https://billing.example/portal',
      })
    );
    const paddle = await toApiError(
      problemResponse(402, {
        title: 'Payment required',
        status: 402,
        code: 'payment_required',
        paddle_checkout_url: 'https://paddle.example/checkout',
      })
    );

    expect(stripe.billingUrl).toBe('https://billing.example/portal');
    expect(paddle.billingUrl).toBe('https://paddle.example/checkout');
  });

  it('prefers the provider-neutral checkout_url over the legacy and portal links', async () => {
    const error = await toApiError(
      problemResponse(402, {
        title: 'Payment required',
        status: 402,
        code: 'payment_required',
        checkout_url: 'https://checkout.example/session',
        billing_portal_url: 'https://billing.example/portal',
        paddle_checkout_url: 'https://paddle.example/checkout',
      })
    );
    expect(error.billingUrl).toBe('https://checkout.example/session');
  });
});

describe('billingUrl with empty links', () => {
  it('skips an empty billing_portal_url instead of returning it', async () => {
    const error = await toApiError(
      problemResponse(402, {
        title: 'Payment required',
        status: 402,
        code: 'payment_required',
        billing_portal_url: '',
        paddle_checkout_url: 'https://paddle.example/checkout',
      })
    );
    expect(error.billingUrl).toBe('https://paddle.example/checkout');
  });

  it('is undefined when every link is empty', async () => {
    const error = await toApiError(
      problemResponse(402, {
        title: 'Payment required',
        status: 402,
        code: 'payment_required',
        billing_portal_url: '',
      })
    );
    expect(error.billingUrl).toBeUndefined();
  });
});

describe('errorMessage', () => {
  it('explains a dropped connection rather than leaking "Failed to fetch"', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toMatch(/could not reach the api/i);
  });

  it('passes an ApiError message through unchanged', async () => {
    const error = await toApiError(
      problemResponse(403, {
        title: 'Forbidden',
        status: 403,
        code: 'plan_limit',
        detail: 'Upgrade to add more apps.',
      })
    );

    expect(errorMessage(error)).toBe('Upgrade to add more apps.');
  });

  it('has something to say about a value that is not an Error at all', () => {
    expect(errorMessage('nope')).toBe('Something went wrong.');
  });
});
