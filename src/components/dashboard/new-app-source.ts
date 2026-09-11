export type AppSource = 'git' | 'empty' | 'template' | 'import';
export interface NewAppSearch {
  source?: AppSource;
  template?: string;
  step?: 'configure' | 'review';
  slug?: string;
  branch?: string;
}

export function validateNewAppSearch(search: Record<string, unknown>): NewAppSearch {
  return {
    source:
      search.source === 'git' ||
      search.source === 'empty' ||
      search.source === 'template' ||
      search.source === 'import'
        ? search.source
        : undefined,
    template: typeof search.template === 'string' ? search.template : undefined,
    step: search.step === 'configure' || search.step === 'review' ? search.step : undefined,
    slug: typeof search.slug === 'string' ? search.slug : undefined,
    branch: typeof search.branch === 'string' ? search.branch : undefined,
  };
}
const GITHUB_REPO = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
const FORBIDDEN_REF_CHAR = /[\\`?%[\]{}<>"'*:^~]/;

function hasControlOrSpace(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x20 || code === 0x7f;
  });
}

export function isValidGitHubRepo(value: string): boolean {
  return GITHUB_REPO.test(value.trim());
}

/** Mirrors apid's cheap Git-ref preflight before githubd resolves it. */
export function isValidGitRef(value: string): boolean {
  const ref = value.trim();
  if (
    ref.length < 1 ||
    ref.length > 200 ||
    ref === '@' ||
    ref.startsWith('/') ||
    ref.endsWith('/') ||
    ref.includes('//') ||
    ref.includes('..') ||
    ref.includes('@{') ||
    ref.endsWith('.') ||
    hasControlOrSpace(ref) ||
    FORBIDDEN_REF_CHAR.test(ref)
  ) {
    return false;
  }
  if (ref.length < 7 && /^[0-9a-f]+$/.test(ref)) return false;
  return ref
    .split('/')
    .every(
      (part) =>
        part.length > 0 && !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock')
    );
}
