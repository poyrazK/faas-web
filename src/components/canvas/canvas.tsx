import '@xyflow/react/dist/base.css';
import './canvas.css';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  MiniMap,
  ReactFlow,
  useNodesState,
  useReactFlow,
  useStore,
  ViewportPortal,
} from '@xyflow/react';
import { nodeTypes, type FlowNode } from './nodes';
import { DraftFlowNode } from './draft-node';
import { edgeTypes, type WindFlowEdge } from './wind-edge';
import { CanvasToolbar } from './canvas-toolbar';
import { nodeTitle, type CanvasNodeData } from './topology';

const allNodeTypes = { ...nodeTypes, draft: DraftFlowNode };

/**
 * React Flow does the mechanics: pan, zoom, selection, focus. Every visible
 * thing is ours, and only the base stylesheet is imported, never the themed
 * one. Positions are not persisted; a reload returns to the computed layout.
 *
 * Nodes live in React Flow's own state so drags apply. New data is merged in
 * by id: a node keeps its dragged position and, when nothing about it changed,
 * its object identity, so React Flow does not re-measure the whole graph on a
 * click or a refetch. The page owns the `ReactFlowProvider`, so the inspector
 * and the toolbar can move the camera too.
 */
export function CanvasView({
  nodes,
  edges,
  selected,
  onSelect,
  onPick,
  onNew,
  settled = true,
  children,
}: {
  nodes: FlowNode[];
  edges: WindFlowEdge[];
  selected?: string;
  onSelect: (id?: string) => void;
  /** A node chosen from the jump finder. */
  onPick: (id: string) => void;
  onNew?: () => void;
  /** The graph is complete; fit it once. */
  settled?: boolean;
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
    <ReactFlow
      className="canvas-surface"
      nodes={flowNodes}
      onNodesChange={onNodesChange}
      edges={edges}
      nodeTypes={allNodeTypes}
      edgeTypes={edgeTypes}
      nodesConnectable={false}
      onNodeClick={(_, node) => {
        // Drafts join `nodes` via a cast, so the union cannot name them.
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
      <CanvasToolbar
        onNew={onNew}
        onPick={onPick}
        items={flowNodes
          .filter((n) => {
            const type: string | undefined = n.type;
            return type !== 'internet' && type !== 'draft' && type !== 'ghost';
          })
          .map((n) => ({
            id: n.id,
            title: nodeTitle(n.data as CanvasNodeData),
            kind: n.type!,
          }))}
      />
      <MinimapWhenNeeded />
      <FitWhenSettled settled={settled} />
    </ReactFlow>
  );
}

/**
 * `fitView` on mount sees only what has loaded so far; buckets and Postgres
 * arrive later. Fit once more, once, when the graph is complete.
 */
function FitWhenSettled({ settled }: { settled: boolean }) {
  const flow = useReactFlow();
  const done = useRef(false);
  useEffect(() => {
    if (!settled || done.current) return;
    done.current = true;
    void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 240 });
  }, [settled, flow]);
  return null;
}

/** The minimap earns its corner only when the graph is bigger than the view. */
function MinimapWhenNeeded() {
  const flow = useReactFlow();
  const w = useStore((s) => s.width);
  const h = useStore((s) => s.height);
  const zoom = useStore((s) => s.transform[2]);
  const count = useStore((s) => s.nodeLookup.size);
  const box = count ? flow.getNodesBounds(flow.getNodes()) : { width: 0, height: 0 };
  if (box.width * zoom <= w && box.height * zoom <= h) return null;
  return (
    <MiniMap
      position="bottom-left"
      pannable
      zoomable
      ariaLabel="Canvas overview"
      className="!m-4 overflow-hidden rounded-xl border border-canvas-glass-border !bg-canvas-glass shadow-elevation-3 backdrop-blur-md"
      style={{ width: 168, height: 104 }}
      maskColor="color-mix(in srgb, var(--background) 55%, transparent)"
      maskStrokeColor="var(--brand)"
      maskStrokeWidth={2}
      nodeColor={(n) =>
        n.selected ? 'var(--brand)' : 'color-mix(in srgb, var(--foreground) 35%, transparent)'
      }
      nodeBorderRadius={4}
    />
  );
}
