import '@xyflow/react/dist/base.css';
import './canvas.css';
import { useEffect, type ReactNode } from 'react';
import { ReactFlow, ReactFlowProvider, useNodesState, ViewportPortal } from '@xyflow/react';
import { nodeTypes, type FlowNode } from './nodes';
import { DraftFlowNode } from './draft-node';
import { edgeTypes, type WindFlowEdge } from './wind-edge';

const allNodeTypes = { ...nodeTypes, draft: DraftFlowNode };

/**
 * React Flow does the mechanics: pan, zoom, selection, focus. Every visible
 * thing is ours, and only the base stylesheet is imported, never the themed
 * one. Positions are not persisted; a reload returns to the computed layout.
 *
 * Nodes live in React Flow's own state so drags apply. New data is merged in
 * by id: a node keeps its dragged position and, when nothing about it changed,
 * its object identity, so React Flow does not re-measure the whole graph on a
 * click or a refetch.
 */
export function CanvasView({
  nodes,
  edges,
  selected,
  onSelect,
  children,
}: {
  nodes: FlowNode[];
  edges: WindFlowEdge[];
  selected?: string;
  onSelect: (id?: string) => void;
  children?: ReactNode;
}) {
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<FlowNode>([]);

  useEffect(() => {
    setFlowNodes((current) => {
      const byId = new Map(current.map((n) => [n.id, n]));
      return nodes.map((n) => {
        const was = byId.get(n.id);
        const isSelected = n.id === selected;
        if (was && was.data === n.data && Boolean(was.selected) === isSelected) return was;
        return { ...n, position: was?.position ?? n.position, selected: isSelected };
      });
    });
  }, [nodes, selected, setFlowNodes]);

  return (
    <ReactFlowProvider>
      <ReactFlow
        className="canvas-surface"
        nodes={flowNodes}
        onNodesChange={onNodesChange}
        edges={edges}
        nodeTypes={allNodeTypes}
        edgeTypes={edgeTypes}
        nodesConnectable={false}
        onNodeClick={(_, node) => {
          // Drafts join `nodes` in Task 10 via a cast, so the union cannot name them.
          const type: string | undefined = node.type;
          if (type !== 'draft') onSelect(type === 'internet' ? undefined : node.id);
        }}
        onPaneClick={() => onSelect(undefined)}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.3}
        maxZoom={1.75}
      >
        <ViewportPortal>{children}</ViewportPortal>
      </ReactFlow>
    </ReactFlowProvider>
  );
}
