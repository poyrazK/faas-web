import type { Topology } from './topology';

/** The selected node, everything one edge away, and those edges. */
export function neighbourhood(t: Topology, id: string): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set([id]);
  const edges = new Set<string>();
  for (const e of t.edges) {
    if (e.source === id || e.target === id) {
      edges.add(e.id);
      nodes.add(e.source);
      nodes.add(e.target);
    }
  }
  return { nodes, edges };
}
