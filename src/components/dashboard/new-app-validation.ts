export function appNameError(value: string): string | undefined {
  if (!value) return 'Enter an app name.';
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(value)) {
    return 'Use 3–40 lowercase letters, numbers or dashes; start and end with a letter or number.';
  }
  if (value.startsWith('tag-')) {
    return 'Names starting with tag- are reserved for deployment-alias hostnames.';
  }
}

/**
 * A repository's name as an app name the wizard will accept: lowercased,
 * every run of other characters folded to one dash, trimmed to 40, and a
 * too-short name lengthened with `-app` rather than rejected. Empty when
 * nothing usable survives, so the customer types one instead.
 */
export function appNameFromRepo(repo: string): string {
  const name = repo.trim().split('/').pop() ?? '';
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  if (slug && slug.length < 3) slug = `${slug}-app`;
  return appNameError(slug) ? '' : slug;
}
