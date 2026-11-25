/**
 * An Atom feed (RFC 4287) of articles and research reports, so feed readers,
 * developer aggregators and crawlers that follow feeds pick up a new page
 * without waiting for the sitemap.
 *
 * Entries carry the dates their registries state; nothing here invents one.
 */

const xml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** A registry date (YYYY-MM-DD) as an Atom timestamp. */
const timestamp = (date) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`feed: bad date ${date}`);
  return `${date}T00:00:00Z`;
};

export function atomFeed({ siteUrl, path, title, entries }) {
  if (!entries.length) throw new Error('feed: no entries');
  const sorted = [...entries].sort(
    (a, b) => b.updated.localeCompare(a.updated) || a.route.localeCompare(b.route)
  );
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${xml(title)}</title>`,
    `  <id>${xml(siteUrl + path)}</id>`,
    `  <link rel="self" type="application/atom+xml" href="${xml(siteUrl + path)}" />`,
    `  <link rel="alternate" type="text/html" href="${xml(siteUrl + '/')}" />`,
    `  <updated>${timestamp(sorted[0].updated)}</updated>`,
    '  <author><name>Gregale</name></author>',
    ...sorted.flatMap((entry) => [
      '  <entry>',
      `    <title>${xml(entry.title)}</title>`,
      `    <id>${xml(siteUrl + entry.route)}</id>`,
      `    <link rel="alternate" type="text/html" href="${xml(siteUrl + entry.route)}" />`,
      `    <published>${timestamp(entry.published)}</published>`,
      `    <updated>${timestamp(entry.updated)}</updated>`,
      `    <summary>${xml(entry.summary)}</summary>`,
      '  </entry>',
    ]),
    '</feed>',
    '',
  ];
  return lines.join('\n');
}
