import { useCallback } from 'react';
import { useReactFlow, useStoreApi } from '@xyflow/react';

type Box = { x: number; y: number; width: number; height: number };

/** The toolbar floats over the bottom of the canvas: nothing there counts as seen. */
export const TOOLBAR_CLEARANCE = 72;

/**
 * The smallest pan that brings `box` fully into `view` with `pad` to spare,
 * in flow units. `fits: false` when no pan can: the box is larger than the
 * view, and only zooming out will do.
 */
export function panToShow(
  box: Box,
  view: Box,
  pad: number
): { fits: boolean; dx: number; dy: number } {
  const fits = box.width + 2 * pad <= view.width && box.height + 2 * pad <= view.height;
  const shift = (lo: number, hi: number, vLo: number, vHi: number) =>
    lo < vLo ? lo - vLo : hi > vHi ? hi - vHi : 0;
  return {
    fits,
    dx: shift(box.x - pad, box.x + box.width + pad, view.x, view.x + view.width),
    dy: shift(box.y - pad, box.y + box.height + pad, view.y, view.y + view.height),
  };
}

/** Camera moves the canvas makes on the user's behalf, always on the console curve. */
export function useCamera() {
  const flow = useReactFlow();
  // Read at call time, not render time: a delayed call (after a panel opens)
  // must measure the viewport as it is then. Subscribing would also re-render
  // the caller, the whole canvas page, on every resize.
  const store = useStoreApi();

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

  /** Like `ensureVisible`, for a box in flow units: room for nodes not drawn yet. */
  const showBox = useCallback(
    (box: Box) => {
      const { width, height } = store.getState();
      const { x, y, zoom } = flow.getViewport();
      const seen = Math.max(0, height - TOOLBAR_CLEARANCE);
      const view = { x: -x / zoom, y: -y / zoom, width: width / zoom, height: seen / zoom };
      const { fits, dx, dy } = panToShow(box, view, 48 / zoom);
      if (!fits) {
        const out = Math.min(zoom, width / (box.width + 96), seen / (box.height + 96));
        // Centre the box in the seen area, above the toolbar.
        const lift = TOOLBAR_CLEARANCE / 2 / out;
        void flow.setCenter(box.x + box.width / 2, box.y + box.height / 2 + lift, {
          zoom: out,
          duration: 380,
        });
        return;
      }
      if (!dx && !dy) return;
      // setCenter centres the whole viewport, toolbar strip included.
      void flow.setCenter(view.x + view.width / 2 + dx, view.y + height / zoom / 2 + dy, {
        zoom,
        duration: 380,
      });
    },
    [flow, store]
  );

  /**
   * Pans the least it can, at the current zoom, so every listed node is fully
   * on screen (the strip under the toolbar does not count). Zooms out only
   * when they cannot fit.
   */
  const ensureVisible = useCallback(
    (ids: string[]) => {
      const nodes = ids
        .map((id) => flow.getNode(id))
        .filter((n): n is NonNullable<typeof n> => Boolean(n));
      if (nodes.length) showBox(flow.getNodesBounds(nodes));
    },
    [flow, showBox]
  );

  return { flyTo, ensureVisible, showBox };
}
