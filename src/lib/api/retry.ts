import { ApiError } from './errors';

/**
 * Shared policy: never retry a settled 4xx, retry the rest twice.
 *
 * Its own module so the root query client can use it without importing
 * `queries.ts` — every public page, the landing page included, loads the root.
 */
export function retryPolicy(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && !error.isRetryable) return false;
  return failureCount < 2;
}
