import { resolveDocPath } from '@/lib/docs-catalog';
import { ApiError } from './errors';

/**
 * What an API error offers beyond its sentence: the stable `code` to quote to
 * support or search for, the API's one-line next step (`hint`), and a docs
 * page about it.
 *
 * `docs_url` is data from the server, and many of the pages it names are not
 * published here, so a link is offered only when it resolves to a page this
 * site serves. A link to a 404 is worse than no link.
 */
export interface ProblemHelp {
  code?: string;
  hint?: string;
  /** Site-relative docs path, e.g. `/docs/custom-domains#verify`. */
  docsHref?: string;
}

const DOCS_ORIGIN = 'https://gregale.dev';

export function problemHelp(error: unknown): ProblemHelp {
  // A synthesised `http_*` code means the API never spoke: there is no code
  // worth quoting and no page about it.
  if (!(error instanceof ApiError) || error.isUnreachable || error.code.startsWith('http_')) {
    return {};
  }
  const help: ProblemHelp = { code: error.code };
  const hint = error.problem.hint?.trim();
  if (hint && hint !== error.message.trim()) help.hint = hint;
  const docsHref =
    publishedDocsHref(error.problem.docs_url) ?? publishedDocsHref(error.problem.type);
  if (docsHref) help.docsHref = docsHref;
  return help;
}

function publishedDocsHref(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value, DOCS_ORIGIN);
  } catch {
    return undefined;
  }
  if (url.origin !== DOCS_ORIGIN || !url.pathname.startsWith('/docs/')) return undefined;
  const path = decodeURIComponent(url.pathname.slice('/docs/'.length));
  if (!/^[a-z0-9_/-]+$/.test(path)) return undefined;
  const target = resolveDocPath(path);
  if (!target) return undefined;
  const slug = 'slug' in target ? target.slug : target.alias;
  // An anchor only means something on the exact page it was written for.
  const exact = 'slug' in target && slug === path.replace(/\/+$/, '');
  return `/docs/${slug}${exact ? url.hash : ''}`;
}
