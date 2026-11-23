/**
 * Drops HTML comments from vendored Markdown before it renders.
 *
 * Upstream docs carry generator markers such as
 * `<!-- BEGIN GENERATED: ... -->`. The renderer does not interpret raw HTML,
 * so without this plugin those markers appear on the page as literal text.
 * Only nodes that are nothing but comments are removed; other raw HTML is
 * left to the renderer's normal handling.
 */
interface Node {
  type: string;
  value?: string;
  children?: Node[];
}

const COMMENT_ONLY = /^\s*(<!--[\s\S]*?-->\s*)+$/;

function strip(node: Node): void {
  if (!node.children) return;
  node.children = node.children.filter(
    (child) => !(child.type === 'html' && COMMENT_ONLY.test(child.value ?? ''))
  );
  node.children.forEach(strip);
}

export function remarkDropHtmlComments() {
  return (tree: Node) => {
    strip(tree);
  };
}
