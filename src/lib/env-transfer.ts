import type { EnvEntry } from './env-parse';

export const ENV_KEY = /^[A-Z][A-Z0-9_]*$/;
export const ENV_SCOPE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
export const ENV_IMPORT_MAX_BYTES = 1024 * 1024;
export interface EnvDiagnostic {
  line: number;
  key?: string;
  reason: string;
}
export interface EnvImport {
  entries: EnvEntry[];
  diagnostics: EnvDiagnostic[];
}

/** Strict import dialect. Diagnostics contain coordinates/names, never values. */
export function parseEnvImport(text: string): EnvImport {
  if (new TextEncoder().encode(text).length > ENV_IMPORT_MAX_BYTES) {
    return {
      entries: [],
      diagnostics: [{ line: 0, reason: 'Input exceeds the 1 MiB import limit.' }],
    };
  }
  const candidates: (EnvEntry & { line: number })[] = [];
  const diagnostics: EnvDiagnostic[] = [];
  const occurrences = new Map<string, number[]>();
  for (const [offset, raw] of text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .entries()) {
    const line = offset + 1;
    const input = raw.trim().replace(/^export\s+/, '');
    if (!input || input.startsWith('#')) continue;
    const equal = input.indexOf('=');
    if (equal < 1) {
      diagnostics.push({ line, reason: 'Expected NAME=value.' });
      continue;
    }
    const key = input.slice(0, equal).trim();
    if (!ENV_KEY.test(key) || key.length > 128) {
      diagnostics.push({
        line,
        reason:
          'Name must be UPPER_SNAKE_CASE, start with a letter, and contain at most 128 characters.',
      });
      continue;
    }
    occurrences.set(key, [...(occurrences.get(key) ?? []), line]);
    const encoded = input.slice(equal + 1).trim();
    let value: string;
    if (encoded.startsWith('"')) {
      const quoted = encoded.match(/^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/);
      try {
        if (!quoted) throw new Error();
        value = JSON.parse(quoted[1]) as string;
      } catch {
        diagnostics.push({
          line,
          key,
          reason: 'Invalid double-quoted value. Use escaped quotes and \\n for newlines.',
        });
        continue;
      }
    } else if (encoded.startsWith("'")) {
      const quoted = encoded.match(/^'([^']*)'\s*(?:#.*)?$/);
      if (!quoted) {
        diagnostics.push({ line, key, reason: 'Invalid single-quoted value.' });
        continue;
      }
      value = quoted[1];
    } else {
      value = encoded.replace(/\s+#.*$/, '').trimEnd();
    }
    if (value.includes('\0')) {
      diagnostics.push({ line, key, reason: 'Values cannot contain NUL characters.' });
      continue;
    }
    candidates.push({ key, value, line });
  }
  for (const [key, lines] of occurrences) {
    if (lines.length > 1)
      for (const line of lines)
        diagnostics.push({
          line,
          key,
          reason: 'Duplicate name. Remove duplicate assignments before importing this key.',
        });
  }
  const entries = candidates.flatMap(({ key, value }) =>
    (occurrences.get(key)?.length ?? 0) > 1 ? [] : [{ key, value }]
  );
  return { entries, diagnostics: diagnostics.sort((a, b) => a.line - b.line) };
}

export function envImportDiff(entries: EnvEntry[], existingKeys: ReadonlySet<string>) {
  return entries.map((entry) => ({
    ...entry,
    action: existingKeys.has(entry.key) ? ('overwrite' as const) : ('add' as const),
  }));
}

/** JSON-quoted dotenv values round-trip with the import dialect, including line breaks. */
export function serializeEnvExport(values: Record<string, string>): string {
  return (
    Object.entries(values)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => {
        if (
          !ENV_KEY.test(key) ||
          key.length > 128 ||
          typeof value !== 'string' ||
          value.includes('\0')
        )
          throw new Error('The export contains an invalid environment entry.');
        return `${key}=${JSON.stringify(value)}`;
      })
      .join('\n') + '\n'
  );
}
