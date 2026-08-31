/**
 * A `.env` parser for the secrets importer.
 *
 * Syntax only — it reports what the file says, and the caller decides what
 * a valid secret name is. Handles the dialects that show up in real files:
 * comments, blank lines, `export ` prefixes, CRLF, single/double quotes
 * (stripped when they wrap the whole value), and `=` inside values.
 */

export interface EnvEntry {
  key: string;
  value: string;
}

export interface ParsedEnv {
  entries: EnvEntry[];
  /** Lines that were not blank, comments, or KEY=VALUE — reported verbatim. */
  invalid: string[];
}

export function parseDotEnv(text: string): ParsedEnv {
  const entries: EnvEntry[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;

    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) {
      invalid.push(raw);
      continue;
    }

    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();
    if (/\s/.test(key)) {
      invalid.push(raw);
      continue;
    }

    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    if (quoted) {
      value = value.slice(1, -1);
    } else {
      // Unquoted values may carry a trailing comment.
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }

    // Later assignments win, like every dotenv loader.
    if (seen.has(key)) {
      const index = entries.findIndex((e) => e.key === key);
      entries[index] = { key, value };
    } else {
      seen.add(key);
      entries.push({ key, value });
    }
  }

  return { entries, invalid };
}
