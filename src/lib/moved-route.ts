import { redirect, type ParsedLocation } from '@tanstack/react-router';

/**
 * A `beforeLoad` for a console page that changed its URL.
 *
 * Several pages kept the path of what they used to be after their label
 * changed — Apps lived at `/workflows`, Instances at `/workers` — so the URL
 * bar contradicted the page. The pages moved; their old paths stay as this
 * redirect so bookmarks and shared links keep landing. Everything after the
 * old prefix (a slug, the query string, the hash) is carried over verbatim,
 * which is why this works on the raw href rather than through each page's
 * search validator.
 */
export function movedTo(from: string, to: string) {
  return ({ location }: { location: ParsedLocation }) => {
    const rest = location.href.startsWith(from) ? location.href.slice(from.length) : '';
    throw redirect({ href: `${to}${rest}`, replace: true });
  };
}
