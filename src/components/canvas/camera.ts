import { useCallback } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';

/** Camera moves the canvas makes on the user's behalf, always on the console curve. */
export function useCamera() {
  const flow = useReactFlow();
  const size = useStore((s) => ({ w: s.width, h: s.height }));

  const flyTo = useCallback(
    (id: string) => {
      const n = flow.getNode(id);
      if (!n) return;
      const w = n.measured?.width ?? 0;
      const h = n.measured?.height ?? 0;
      flow.setCenter(n.position.x + w / 2, n.position.y + h / 2, {
        zoom: Math.max(flow.getZoom(), 1),
        duration: 380,
      });
    },
    [flow]
  );

  /** Pans (never zooms in) so every listed node is fully on screen. */
  const ensureVisible = useCallback(
    (ids: string[]) => {
      const nodes = ids
        .map((id) => flow.getNode(id))
        .filter((n): n is NonNullable<typeof n> => Boolean(n));
      if (!nodes.length) return;
      const box = flow.getNodesBounds(nodes);
      const { x, y, zoom } = flow.getViewport();
      const view = { x: -x / zoom, y: -y / zoom, w: size.w / zoom, h: size.h / zoom };
      const inside =
        box.x >= view.x &&
        box.y >= view.y &&
        box.x + box.width <= view.x + view.w &&
        box.y + box.height <= view.y + view.h;
      if (!inside) void flow.fitBounds(box, { padding: 0.25, duration: 380 });
    },
    [flow, size.w, size.h]
  );

  return { flyTo, ensureVisible };
}
