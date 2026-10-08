import { DOC_ENTRIES, DOC_SECTIONS } from './docs-manifest';
import { docSource } from './docs-content';

const normalize = (value: string) => value.toLowerCase().replace(/[-_]/g, ' ');
const SEARCH_INDEX = DOC_ENTRIES.map((entry) => {
  const text = (docSource(entry.slug) ?? '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`#*>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    entry,
    text,
    normalized: normalize(`${entry.title} ${entry.summary} ${text}`),
    section: DOC_SECTIONS.find((section) => section.entries.includes(entry))!.title,
  };
});

/** Search titles, summaries, commands and article text without a remote service. */
export function searchDocs(query: string) {
  const terms = normalize(query.trim().slice(0, 200)).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return SEARCH_INDEX.filter((item) => terms.every((term) => item.normalized.includes(term)))
    .map((item) => {
      const title = normalize(item.entry.title);
      const score = terms.reduce(
        (total, term) =>
          total +
          (title.includes(term) ? 10 : normalize(item.entry.summary).includes(term) ? 3 : 1),
        0
      );
      const position = normalize(item.text).indexOf(terms[0]);
      const start = Math.max(0, position - 50);
      const excerpt = `${start ? '…' : ''}${item.text.slice(start, start + 160)}${item.text.length > start + 160 ? '…' : ''}`;
      return { ...item, score, excerpt };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}
