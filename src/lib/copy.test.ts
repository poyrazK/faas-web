import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The console says little, and says it in the customer's words.
 *
 * It used to explain itself on every page: a subtitle under each title, a
 * description under most panels, and internal names (apid, microVMs,
 * "evidence", "telemetry") in the copy. `PageHeader` and `Panel` no longer
 * take a description, so TypeScript holds the first rule; this holds the
 * second. Only visible copy is read — JSX text and the props and toast fields
 * people see — so a variable or a query key may use any word it likes.
 */

const INTERNAL = /\bapid\b|firecracker|\bmicro-?vms?\b|\bevidence\b|\btelemetry\b/i;

/** Props whose string value reaches the screen or a screen reader. */
const COPY_PROPS = new Set([
  'title',
  'label',
  'message',
  'emptyMessage',
  'filteredEmptyMessage',
  'loadingMessage',
  'placeholder',
  'aria-label',
  'help',
  'note',
  'feature',
  'resource',
  'description',
  'confirmLabel',
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

const files = [
  ...walk(resolve('src/components/dashboard')),
  ...readdirSync(resolve('src/routes'))
    .filter((name) => /^dashboard\..*\.tsx$/.test(name))
    .map((name) => resolve('src/routes', name)),
].filter((file) => !file.includes('/kit/gallery'));

/** Every piece of visible copy in a file, with its line. */
function copyOf(file: string): { line: number; text: string }[] {
  const source = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: { line: number; text: string }[] = [];
  const add = (node: ts.Node, text: string) =>
    found.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text });
  const strings = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text);
    else if (ts.isTemplateExpression(node)) {
      add(node, [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' '));
    }
    ts.forEachChild(node, strings);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && node.text.trim()) add(node, node.text);
    else if (ts.isJsxExpression(node) && ts.isJsxElement(node.parent) && node.expression)
      strings(node.expression);
    else if (ts.isJsxAttribute(node) && COPY_PROPS.has(node.name.getText(sf)) && node.initializer)
      strings(node.initializer);
    else if (
      ts.isPropertyAssignment(node) &&
      ['title', 'description', 'message'].includes(node.name.getText(sf))
    )
      strings(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('console copy', () => {
  it('scans the console sources', () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it('keeps internal names out of what people read', () => {
    const offenders = files.flatMap((file) =>
      copyOf(file)
        .filter(({ text }) => INTERNAL.test(text))
        .map(({ line, text }) => `${file.split('/src/')[1]}:${line} ${text.trim().slice(0, 80)}`)
    );
    expect(offenders).toEqual([]);
  });
});
