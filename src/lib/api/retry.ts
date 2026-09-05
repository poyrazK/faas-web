import { ApiError } from './errors';

/** Shared policy: never retry a settled 4xx, retry transient failures twice. */
export function retryPolicy(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && !error.isRetryable) return false;
  return failureCount < 2;
}
