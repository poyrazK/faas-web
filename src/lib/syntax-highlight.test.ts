import type { Element, Root, RootContent } from 'hast';
import { describe, expect, it } from 'vitest';
import { highlightCode, highlightLanguage, rehypeHighlightCode } from './syntax-highlight';

function text(node: Root | RootContent): string {
  if (node.type === 'text') return node.value;
  return 'children' in node ? node.children.map(text).join('') : '';
}

/** The text of every element whose classes are exactly `classes`, in order. */
function spans(root: Root, classes: string): string[] {
  const out: string[] = [];
  const walk = (node: Root | RootContent) => {
    if (node.type === 'element') {
      const names = (node as Element).properties.className;
      if (Array.isArray(names) && names.join(' ') === classes) out.push(text(node));
    }
    if ('children' in node) node.children.forEach(walk);
  };
  walk(root);
  return out;
}

/** The text of every token highlight.js scoped `scope`, in order. */
function scoped(code: string, language: string, scope: string): string[] {
  const classes = scope
    .split(' ')
    .map((part, i) => (i === 0 ? `hljs-${part}` : part))
    .join(' ');
  return spans(highlightCode(code, language)!, classes);
}

describe('shell highlighting', () => {
  it('marks the command and its flags', () => {
    const code = 'gregale deploy --app api -f gregale.yaml';
    expect(scoped(code, 'sh', 'title function_')).toEqual(['gregale']);
    expect(scoped(code, 'sh', 'attr')).toEqual(['--app', '-f']);
  });

  it('dims a prompt and still finds the command after it', () => {
    const code = '$ gregale logs api --follow';
    expect(scoped(code, 'bash', 'meta')).toEqual(['$']);
    expect(scoped(code, 'bash', 'title function_')).toEqual(['gregale']);
  });

  it('finds the command after a pipe or a chain, not in its arguments', () => {
    const code = 'gregale apps --json | jq .items && echo done';
    expect(scoped(code, 'sh', 'title function_')).toEqual(['gregale', 'jq', 'echo']);
  });

  it('leaves the first word of a continued line as an argument', () => {
    const code = 'gregale deploy \\\n  my-api \\\n  --image ghcr.io/acme/api:1';
    expect(scoped(code, 'sh', 'title function_')).toEqual(['gregale']);
    expect(scoped(code, 'sh', 'attr')).toEqual(['--image']);
  });

  it('does not treat keywords or assignments as commands', () => {
    expect(scoped('export FAAS_TOKEN=abc', 'sh', 'title function_')).toEqual([]);
    expect(scoped('if true; then gregale whoami; fi', 'sh', 'keyword')).toEqual([
      'if',
      'then',
      'fi',
    ]);
    expect(scoped('FAAS_TOKEN=abc gregale whoami', 'sh', 'title function_')).toEqual([]);
  });

  it('keeps strings, variables and comments', () => {
    const code = 'curl -H "Authorization: Bearer $FAAS_TOKEN" https://api.gregale.dev # list';
    expect(scoped(code, 'sh', 'comment')).toEqual(['# list']);
    expect(scoped(code, 'sh', 'variable')).toEqual(['$FAAS_TOKEN']);
    expect(scoped(code, 'sh', 'attr')).toEqual(['-H']);
  });
});

describe('languages', () => {
  it('resolves the fence names the docs use', () => {
    for (const fence of [
      'bash',
      'sh',
      'shell',
      'console',
      'yaml',
      'yml',
      'json',
      'js',
      'ts',
      'python',
      'go',
      'toml',
      'dotenv',
      'http',
      'dockerfile',
    ]) {
      expect(highlightLanguage(fence), fence).not.toBeNull();
    }
  });

  it('leaves text, unknown and missing languages plain', () => {
    expect(highlightLanguage('text')).toBeNull();
    expect(highlightLanguage('mermaid')).toBeNull();
    expect(highlightLanguage(undefined)).toBeNull();
    expect(highlightCode('anything', 'text')).toBeNull();
  });

  it('colours YAML keys and JSON values', () => {
    expect(scoped('app: api\nram_mb: 512', 'yaml', 'attr')).toEqual(['app:', 'ram_mb:']);
    expect(scoped('{"ok": true, "n": 3}', 'json', 'literal')).toEqual(['true']);
  });
});

describe('rehypeHighlightCode', () => {
  function tree(className: string[] | undefined, text: string): Root {
    return {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'pre',
          properties: {},
          children: [
            {
              type: 'element',
              tagName: 'code',
              properties: className ? { className } : {},
              children: [{ type: 'text', value: text }],
            },
          ],
        },
      ],
    };
  }

  it('highlights a fenced block with a known language', () => {
    const root = tree(['language-sh'], 'gregale open api');
    rehypeHighlightCode()(root);
    expect(spans(root, 'hljs-title function_')).toEqual(['gregale']);
    expect(text(root)).toBe('gregale open api');
  });

  it('leaves unknown and unlabelled blocks untouched', () => {
    for (const root of [
      tree(['language-text'], 'gregale open api'),
      tree(undefined, 'gregale open api'),
    ]) {
      const before = JSON.stringify(root);
      rehypeHighlightCode()(root);
      expect(JSON.stringify(root)).toBe(before);
    }
  });

  it('never touches inline code', () => {
    const root: Root = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [
            {
              type: 'element',
              tagName: 'code',
              properties: { className: ['language-sh'] },
              children: [{ type: 'text', value: 'gregale' }],
            },
          ],
        },
      ],
    };
    const before = JSON.stringify(root);
    rehypeHighlightCode()(root);
    expect(JSON.stringify(root)).toBe(before);
  });
});
