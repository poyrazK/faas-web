import { expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { scanUnavailableReason } from './scan-source';

const problem = (status: number, code: string) => new ApiError({ status, code, title: code });

it.each([
  [problem(403, 'forbidden'), /could not read this repository/],
  [problem(404, 'not_found'), /could not read this repository/],
  [problem(409, 'validation_failed'), /could not detect a service/],
  [problem(413, 'source_too_large'), /too large to scan/],
  [problem(429, 'auth_rate_limited'), /busy right now/],
  [problem(503, 'capacity_unavailable'), /busy right now/],
  [problem(503, 'something_new'), /scan is unavailable/],
  [new TypeError('Failed to fetch'), /scan is unavailable/],
])('explains a scan that gave no hint (%s)', (error, reason) => {
  expect(scanUnavailableReason(error)).toMatch(reason);
});
