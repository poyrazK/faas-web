import type { AppSource, NewAppSearch } from './new-app-source';

export type Station = 'sources' | 'setup' | 'configure' | 'review';

const WITH_SETUP: readonly AppSource[] = ['git', 'template', 'container', 'worker', 'import'];

// These finish on their own page, with their own submit: no Configure or Review.
const OWN_PAGE: readonly AppSource[] = ['container', 'worker', 'import'];

/** Empty needs no setup; every other source has a page of its own. */
export function hasSetup(source?: AppSource): boolean {
  return source !== undefined && WITH_SETUP.includes(source);
}

/**
 * Where the wizard is, from the URL. A source named in the URL (a GitHub
 * return, a template link) lands on its Setup; one only inferred (Git,
 * preselected because GitHub is connected) leaves the person on Sources to
 * see the choices. Configure and Review are reachable only once what they
 * need is valid, so a reloaded URL falls back to the earliest unfinished
 * station rather than exposing an invalid one.
 */
export function stationFor(i: {
  step?: NewAppSearch['step'];
  source?: AppSource;
  named: boolean;
  sourceValid: boolean;
  nameValid: boolean;
}): Station {
  // Only a source the person chose has a Setup to fall back to.
  const fallback: Station = i.named && hasSetup(i.source) ? 'setup' : 'sources';
  if (i.step === 'review' || i.step === 'configure') {
    if (!i.sourceValid) return fallback;
    if (i.source && OWN_PAGE.includes(i.source)) return 'setup';
    return i.step === 'review' && i.nameValid ? 'review' : 'configure';
  }
  if (i.step === 'setup')
    return hasSetup(i.source) ? 'setup' : i.sourceValid ? 'configure' : 'sources';
  if (i.step === 'source') return 'sources';
  return i.named && hasSetup(i.source) ? 'setup' : 'sources';
}

/** The `step` the URL should carry to come back to `station`. */
export function stepForStation(
  station: Station,
  step?: NewAppSearch['step']
): NewAppSearch['step'] {
  if (station === 'review') return 'review';
  if (station === 'configure') return 'configure';
  if (station === 'setup') return step === 'setup' ? 'setup' : undefined;
  return step === 'source' ? 'source' : undefined;
}
