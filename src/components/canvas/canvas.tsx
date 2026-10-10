import '@xyflow/react/dist/base.css';
import './canvas.css';
import type { ReactNode } from 'react';
import { ReactFlow, ReactFlowProvider, ViewportPortal } from '@xyflow/react';
import { nodeTypes, type FlowNode } from './nodes';
import { DraftFlowNode } from './draft-node';
import { edgeTypes, type WindFlowEdge } from './wind-edge';

const allNodeTypes = { ...nodeTypes, draft: DraftFlowNode };

/**
 * React Flow does the mechanics: pan, zoom, selection, focus. Every visible
 * thing is ours, and only the base stylesheet is imported, never the themed
 * one. Positions are not persisted; a reload returns to the computed layout.
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
  return (
    <ReactFlowProvider>
      <ReactFlow
        className="canvas-surface"
        nodes={nodes.map((n) => ({ ...n, selected: n.id === selected }))}
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
