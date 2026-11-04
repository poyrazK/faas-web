import { useMemo } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { highlightCode } from '@/lib/syntax-highlight';

/**
 * A code sample outside markdown — the API reference's curl requests and
 * example responses — coloured by the same grammars and `--syntax-*` tokens
 * as the docs' fenced blocks. A language with no grammar renders as plain
 * text, so this is always safe to use in place of a bare `<code>`.
 */
export function HighlightedCode({ code, language }: { code: string; language: string }) {
  const content = useMemo(() => {
    const tree = highlightCode(code, language);
    return tree ? toJsxRuntime(tree, { Fragment, jsx, jsxs }) : code;
  }, [code, language]);
  return <code className={`language-${language}`}>{content}</code>;
}
