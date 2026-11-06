import { useCallback, useLayoutEffect, useRef } from 'react';

/** One indicator per strip. The selected control remains the source of truth. */
export function useSelectionIndicator(kind: 'tab' | 'segment') {
  const root = useRef<HTMLElement | null>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const setRoot = useCallback((node: HTMLElement | null) => {
    root.current = node;
  }, []);
  useLayoutEffect(() => {
    const frame = root.current;
    const line = indicatorRef.current;
    if (!frame || !line || !frame.closest('.console')) return;
    let alive = true;
    let keyboard = false;
    let lastRow: number | undefined;
    const measure = () => {
      if (!alive) return;
      const selected = frame.querySelector<HTMLElement>(`.console-${kind}-current`);
      if (!selected) {
        delete frame.dataset.indicatorReady;
        lastRow = undefined;
        return;
      }
      const box = frame.getBoundingClientRect();
      const item = selected.getBoundingClientRect();
      if (!item.width || !box.width) return;
      const scale = frame.offsetWidth ? box.width / frame.offsetWidth : 1;
      const x = (item.left - box.left) / scale - frame.clientLeft + frame.scrollLeft;
      const row = (item.top - box.top) / scale - frame.clientTop + frame.scrollTop;
      const y = kind === 'tab' ? row + item.height / scale - 2 : row;
      // Wrapping, resize and keyboard changes snap; pointer changes on the
      // same row retarget the running CSS transition without queuing work.
      const snap = keyboard || lastRow === undefined || Math.abs(row - lastRow) > 1;
      if (snap) line.style.transition = 'none';
      line.style.width = `${item.width / scale}px`;
      line.style.height = kind === 'tab' ? '2px' : `${item.height / scale}px`;
      line.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (snap) {
        line.getBoundingClientRect();
        line.style.transition = '';
      }
      frame.dataset.indicatorReady = 'true';
      lastRow = row;
      keyboard = false;
    };
    const resize = new ResizeObserver(() => {
      keyboard = true;
      measure();
    });
    const observe = () => {
      resize.disconnect();
      resize.observe(frame);
      frame.querySelectorAll(`.console-${kind}`).forEach((item) => resize.observe(item));
    };
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => record.type === 'childList')) observe();
      measure();
    });
    const onKey = () => {
      keyboard = true;
    };
    const onPointer = () => {
      keyboard = false;
    };
    frame.addEventListener('keydown', onKey, true);
    frame.addEventListener('pointerdown', onPointer, true);
    frame.addEventListener('scroll', measure, { passive: true });
    mutations.observe(frame, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    observe();
    measure();
    void document.fonts?.ready.then(measure);
    return () => {
      alive = false;
      resize.disconnect();
      mutations.disconnect();
      frame.removeEventListener('keydown', onKey, true);
      frame.removeEventListener('pointerdown', onPointer, true);
      frame.removeEventListener('scroll', measure);
    };
  }, [kind]);
  return { setRoot, indicatorRef };
}
