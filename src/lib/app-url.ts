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

/**
 * The platform zone apps are served under when nothing better is known —
 * "the default `*.gregale.dev` hostname" (content/docs/custom-domains.md).
 */
export const DEFAULT_APP_ZONE = 'gregale.dev';

/**
 * The public URL an app named `slug` will be given, before it exists.
 *
 * An app's platform URL is its slug under the platform zone
 * (`AppResponse.url`, e.g. https://my-app.gregale.dev). The zone is read
 * from an app the account already has, so a self-hosted box or the dev mock
 * predicts its own hostnames; only with no app to learn from does it fall
 * back to the documented default. Returned through `publicAppUrl`, the same
 * gate every API-assigned endpoint passes, without a trailing slash so it
 * reads like the URL the API will return.
 */
export function predictedAppUrl(
  slug: string,
  known: readonly { slug: string; url?: string | null }[] = []
): string | undefined {
  let origin = `https://${slug}.${DEFAULT_APP_ZONE}`;
  for (const app of known) {
    const href = publicAppUrl(app.url);
    if (!href) continue;
    const url = new URL(href);
    const prefix = `${app.slug}.`;
    if (!url.hostname.startsWith(prefix) || url.hostname.length === prefix.length) continue;
    origin = `${url.protocol}//${slug}.${url.hostname.slice(prefix.length)}${url.port ? `:${url.port}` : ''}`;
    break;
  }
  return publicAppUrl(origin)?.replace(/\/$/, '');
}
