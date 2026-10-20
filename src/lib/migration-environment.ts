import { parseDotEnv } from './env-parse';

const KEY = /^[A-Z][A-Z0-9_]*$/;

/** Diagnostics contain names and counts only, never pasted values or lines. */
export function migrationEnvironment(
  text: string,
  required: string[] = [],
  connections: Record<string, string> = {}
) {
  const parsed = parseDotEnv(text);
  const values: Record<string, string> = {};
  const errors: string[] = [];
  const names = new Set<string>();
  const duplicates = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line.trim());
    if (!match) continue;
    if (names.has(match[1])) duplicates.add(match[1]);
    names.add(match[1]);
  }
  if (parsed.invalid.length) errors.push(`${parsed.invalid.length} line(s) need KEY=VALUE syntax.`);
  if (duplicates.size) errors.push(`Remove duplicate keys: ${[...duplicates].sort().join(', ')}.`);
  for (const entry of parsed.entries) {
    if (connections[entry.key]) continue;
    if (!KEY.test(entry.key)) {
      errors.push('Variable names must use uppercase letters, digits, and underscores.');
    } else if (!entry.value) {
      errors.push(`${entry.key} is empty. Supply a value or omit this key.`);
    } else {
      values[entry.key] = entry.value;
    }
  }
  const missing = required.filter((key) => !values[key] && !connections[key]);
  if (missing.length) errors.push(`Required by your repository: ${missing.join(', ')}.`);
  return { values, keys: Object.keys(values).sort(), errors };
}
