/**
 * One form for an ID the API writes two ways: most routes return 32 hex
 * characters, while organization inventories return hyphenated UUIDs.
 */
export function normalizeId(id: string): string {
  return id.replace(/-/g, '').toLowerCase();
}
