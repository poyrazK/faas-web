import type { components } from './api/schema';

export function validateCacheAction(
  action: components['schemas']['EdgeRuleCacheAction']
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (
    !Number.isInteger(action.max_age_seconds) ||
    action.max_age_seconds < 0 ||
    action.max_age_seconds > 3600
  )
    errors.max_age_seconds =
      'Use a whole number from 0 to 3600 seconds; 0 uses the 60-second default.';
  const swr = action.stale_while_revalidate_seconds ?? 0;
  if (!Number.isInteger(swr) || swr < 0 || swr > 300)
    errors.stale_while_revalidate_seconds =
      'Use a whole number from 0 to 300 seconds; 0 disables stale while revalidate.';
  if (
    !Number.isInteger(action.stale_if_error_seconds) ||
    action.stale_if_error_seconds < 0 ||
    action.stale_if_error_seconds > 300
  )
    errors.stale_if_error_seconds =
      'Use a whole number from 0 to 300 seconds; 0 disables stale on error.';
  if (
    action.methods != null &&
    (!Array.isArray(action.methods) ||
      action.methods.some((method) => method !== 'GET' && method !== 'HEAD'))
  )
    errors.methods = 'Only GET and HEAD can be cached.';
  if (
    action.vary_on != null &&
    (!Array.isArray(action.vary_on) ||
      action.vary_on.some((header) => header !== 'Accept-Language' && header !== 'Accept-Encoding'))
  )
    errors.vary_on = 'Only Accept-Language and Accept-Encoding can vary the cache.';
  return errors;
}

export function cachePurgeSelection(
  mode: 'all' | 'path' | 'tag',
  input: string
): { path?: string; tag?: string } {
  if (mode === 'all') return {};
  const value = input.trim();
  if (mode === 'path') {
    if (!value || (!value.startsWith('/') && value !== '*'))
      throw new Error('Enter a normalized path glob starting with /.');
    if (new TextEncoder().encode(value).length > 1024)
      throw new Error('The path glob is too long (maximum 1024 bytes).');
    return { path: value };
  }
  if (value.length > 128) throw new Error('The cache tag must be at most 128 bytes.');
  if (!/^[A-Za-z0-9._:/-]+$/.test(value))
    throw new Error(
      'Enter one cache tag using letters, digits, dot, underscore, colon, slash or dash.'
    );
  return { tag: value.toLowerCase() };
}
