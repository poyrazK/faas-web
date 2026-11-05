import type { Element, ElementContent, Root } from 'hast';
import type { HLJSApi, Language, LanguageFn, Mode } from 'highlight.js';
import { toText } from 'hast-util-to-text';
import bash from 'highlight.js/lib/languages/bash';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import http from 'highlight.js/lib/languages/http';
import ini from 'highlight.js/lib/languages/ini';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import yaml from 'highlight.js/lib/languages/yaml';
import { createLowlight } from 'lowlight';
import { visit } from 'unist-util-visit';

/**
 * Syntax highlighting for the docs' code blocks.
 *
 * Only the grammars the vendored docs and the API reference actually fence
 * are registered — shell is three quarters of every block, then YAML, JSON
 * and a handful of others. The core is ~22 KB gzipped and every grammar adds
 * to the docs chunk, so a language fenced once or twice earns no grammar of
 * its own: TypeScript (6.7 KB) reads correctly as JavaScript, and PowerShell
 * stays plain. `createLowlight` is imported on its own rather than through
 * `rehype-highlight`, whose default pulls lowlight's 37-grammar `common` set
 * into the bundle even when a smaller list is passed.
 *
 * The output is hast with highlight.js's `hljs-*` class names; the colours
 * come from the `--syntax-*` tokens in `index.css`, so a block reads the same
 * in either polarity and no grammar ships a colour of its own.
 */

/** Words that start a shell statement but are not a command to run. */
const SHELL_STATEMENT_WORDS =
  'if|then|else|elif|fi|for|while|until|do|done|case|esac|in|function|select|time|export|local|readonly|declare|return|set|unset|source|alias';

/**
 * Bash, plus what makes a CLI walkthrough scannable.
 *
 * Stock highlight.js leaves `gregale deploy --app api` entirely plain: it
 * colours keywords, strings and `$VARS`, but not the command being run or its
 * flags — and those are most of what the docs' shell blocks are. So:
 *
 * - a `$ ` prompt is dimmed, so it reads as not-part-of-the-command;
 * - the first word of each command (at line start, or after `|`, `&&`, `||`,
 *   `;` or `(`) is the command — except on a line continued from a trailing
 *   backslash, whose first word is an argument, and except shell keywords and
 *   `NAME=value` assignments;
 * - `-x` and `--long-flag` tokens are flags.
 */
function shell(hljs: HLJSApi): Language {
  const base = bash(hljs);
  const prompt: Mode = { scope: 'meta', match: /^[ \t]*\$(?=[ \t])/ };
  const command: Mode = {
    scope: 'title.function',
    match: new RegExp(
      String.raw`(?<!\\\n[ \t]*)(?<=^[ \t]*(?:\$[ \t]+)?|[|&;(][ \t]*)` +
        String.raw`(?!(?:${SHELL_STATEMENT_WORDS})\b)(?![\w.-]*=)[A-Za-z_][\w.-]*`
    ),
  };
  const flag: Mode = { scope: 'attr', match: /(?<=[\s=])--?[A-Za-z][\w-]*/ };
  return { ...base, contains: [prompt, command, flag, ...(base.contains ?? [])] };
}

const lowlight = createLowlight({
  bash: shell as LanguageFn,
  dockerfile,
  go,
  http,
  ini,
  javascript,
  json,
  python,
  yaml,
});

// The grammars bring their usual aliases (`sh`, `yml`, `ts`, `py`, `toml`, …);
// these are the fence names the docs use that they do not cover.
lowlight.registerAlias({
  bash: ['shell', 'console'],
  ini: ['dotenv', 'env'],
  javascript: ['ts', 'typescript', 'tsx'],
});

/** The registered grammar for a fence language, or null to leave it plain. */
export function highlightLanguage(language: string | undefined): string | null {
  if (!language) return null;
  const name = language.toLowerCase();
  return lowlight.registered(name) ? name : null;
}

/** Highlight `code` as `language`; null when the language has no grammar. */
export function highlightCode(code: string, language: string): Root | null {
  const name = highlightLanguage(language);
  return name ? lowlight.highlight(name, code) : null;
}

function fenceLanguage(node: Element): string | undefined {
  const classes = node.properties.className;
  if (!Array.isArray(classes)) return undefined;
  for (const value of classes) {
    const match = /^language-(.+)$/.exec(String(value));
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Rehype plugin: highlight every fenced block (`pre > code.language-*`) with a
 * registered grammar. Unknown and unlabelled fences (`text`, plain output) are
 * left exactly as they were — no auto-detection, which guesses wrong on short
 * snippets and costs a pass over every grammar.
 */
export function rehypeHighlightCode() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, _index, parent) => {
      if (node.tagName !== 'code' || parent?.type !== 'element' || parent.tagName !== 'pre') {
        return;
      }
      const result = highlightCode(toText(node, { whitespace: 'pre' }), fenceLanguage(node) ?? '');
      if (!result) return;
      node.children = result.children as ElementContent[];
    });
  };
}
