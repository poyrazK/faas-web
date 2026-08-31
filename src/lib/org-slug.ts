/** 3–40 chars, lowercase kebab: letters/digits with single hyphens between runs. */
export const isValidOrgSlug = (s: string) =>
  s.length >= 3 && s.length <= 40 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);

/** The slug suggestion that follows the display name until edited by hand. */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
