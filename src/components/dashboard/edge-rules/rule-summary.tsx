/** Keep the full sentence readable while accenting only its action and saved values. */
export function RuleSummary({ text, emphasis }: { text: string; emphasis: readonly string[] }) {
  const terms = [...new Set(emphasis.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!terms.length) return text;
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const matcher = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${escaped.join('|')})(?![\\p{L}\\p{N}_])`,
    'gu'
  );
  const parts = [];
  let end = 0;
  for (const match of text.matchAll(matcher)) {
    const start = match.index;
    if (start > end) parts.push(text.slice(end, start));
    parts.push(
      <span key={start} className="text-brand">
        {match[0]}
      </span>
    );
    end = start + match[0].length;
  }
  parts.push(text.slice(end));
  return <>{parts}</>;
}
