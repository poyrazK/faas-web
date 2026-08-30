/**
 * Accept only same-origin application paths for post-authentication returns.
 * The CLI auth flow supplies `/cli-auth?code=…`; external URLs and protocol
 * relative URLs must never be accepted as a login redirect.
 */
export function safeInternalPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const path = value.trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return undefined;
  return path;
}
