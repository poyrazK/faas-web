import { resourceId } from '@/lib/resource-id';

export interface DeploymentRecoveryContext {
  app: string;
  repo: string;
  ref: string;
  deployment?: string;
  phase?: 'submitting' | 'rejected' | 'unknown';
}

export function validateRecovery(value: unknown): DeploymentRecoveryContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.app !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(raw.app) ||
    typeof raw.repo !== 'string' ||
    raw.repo.length > 512 ||
    !isValidGitHubRepo(raw.repo) ||
    typeof raw.ref !== 'string' ||
    !isValidGitRef(raw.ref) ||
    (raw.deployment !== undefined && !resourceId(raw.deployment))
  )
    return undefined;
  return {
    app: raw.app,
    repo: raw.repo.trim(),
    ref: raw.ref.trim(),
    deployment: resourceId(raw.deployment),
    phase:
      raw.phase === 'submitting' || raw.phase === 'rejected' || raw.phase === 'unknown'
        ? raw.phase
        : undefined,
  };
}

export type AppSource = 'git' | 'container' | 'empty' | 'template' | 'import';
export interface NewAppSearch {
  source?: AppSource;
  template?: string;
  step?: 'configure' | 'review';
  slug?: string;
  branch?: string;
  recovery?: DeploymentRecoveryContext;
}

export function validateNewAppSearch(search: Record<string, unknown>): NewAppSearch {
  return {
    source:
      search.source === 'git' ||
      search.source === 'container' ||
      search.source === 'empty' ||
      search.source === 'template' ||
      search.source === 'import'
        ? search.source
        : undefined,
    template: typeof search.template === 'string' ? search.template : undefined,
    step: search.step === 'configure' || search.step === 'review' ? search.step : undefined,
    slug: typeof search.slug === 'string' ? search.slug : undefined,
    branch: typeof search.branch === 'string' ? search.branch : undefined,
    recovery: validateRecovery(search.recovery),
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
