/** Only API-assigned HTTP(S) destinations can become external console links. */
export function publicAppUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** A route label has a method and a raw path; never let a path change the host. */
export function appRouteUrl(base: string | null | undefined, path: string): string | undefined {
  const href = publicAppUrl(base);
  if (!href || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    return undefined;
  }
  const origin = new URL(href).origin;
  const url = new URL(path, origin);
  return url.origin === origin ? url.href : undefined;
}
