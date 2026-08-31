import type { components } from '@/lib/api/schema';

type Resp = components['schemas']['DiffResponse'];

export function breakCounts(resp: Resp): { error: number; warn: number } {
  let error = 0;
  let warn = 0;
  for (const b of resp.diff.breaks) {
    if (b.severity === 'error') error++;
    else warn++;
  }
  return { error, warn };
}

/** Lenient mirrors the server's `blocking`; strict is `gregale deploy --diff --strict`. */
export function isBlocking(resp: Resp, strict: boolean): boolean {
  if (resp.blocking) return true;
  return strict && breakCounts(resp).warn > 0;
}
