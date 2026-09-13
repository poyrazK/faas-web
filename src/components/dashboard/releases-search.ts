export const RELEASE_SECTIONS = [
  ['overview', 'Overview'],
  ['output', 'Build output'],
  ['provenance', 'Provenance / SBOM'],
  ['scans', 'Security scans'],
  ['lifecycle', 'Lifecycle'],
  ['runtime', 'Runtime controls'],
  ['audit', 'Audit context'],
] as const;
export type ReleaseSection = (typeof RELEASE_SECTIONS)[number][0];
export interface ReleasesSearch extends Record<string, unknown> {
  view?: 'releases' | 'builds';
  deployment?: string;
  build?: string;
  releaseSection?: ReleaseSection;
  q?: string;
  status?: string;
  kind?: string;
}

/** Validate only fields owned by Releases; other search owners survive navigation. */
export function validateReleasesSearch(raw: Record<string, unknown>): ReleasesSearch {
  const search = { ...raw } as ReleasesSearch;
  for (const key of ['deployment', 'build', 'q', 'status', 'kind'] as const) {
    if (typeof raw[key] !== 'string' || !raw[key].trim()) search[key] = undefined;
  }
  if (raw.view !== 'releases' && raw.view !== 'builds') search.view = undefined;
  if (!RELEASE_SECTIONS.some(([value]) => value === raw.releaseSection))
    search.releaseSection = undefined;
  // A section alone cannot select an entity; a valid parent survives bad children.
  if (!search.deployment && !search.build) search.releaseSection = undefined;
  return search;
}

export function sourceSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
