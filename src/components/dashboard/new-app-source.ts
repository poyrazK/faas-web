const GITHUB_REPO = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
const FORBIDDEN_REF_CHAR = /[\\\0`?%[\]{}<>"'*\x00-\x20\x7f:^~]/;

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
