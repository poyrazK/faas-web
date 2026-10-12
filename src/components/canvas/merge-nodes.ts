type XY = { x: number; y: number };
type Mergeable = {
  id: string;
  position: XY;
  data: unknown;
  selected?: boolean;
  style?: unknown;
};

const same = (a: XY, b: XY) => a.x === b.x && a.y === b.y;

/**
 * New layout output merged into the nodes React Flow holds. A node still where
 * the last layout put it follows the new layout (a draft opening, a band
 * growing); a node the user dragged away stays where it was dropped. When
 * nothing about a node changed it keeps its object identity, so React Flow
 * does not re-measure it.
 */
export function mergeNodes<T extends Mergeable>(
  current: readonly T[],
  next: readonly T[],
  selected: string | undefined,
  laid: ReadonlyMap<string, XY>
): T[] {
  const byId = new Map(current.map((n) => [n.id, n]));
  return next.map((n) => {
    const was = byId.get(n.id);
    const isSelected = n.id === selected;
    const prev = laid.get(n.id);
    const dragged = was && prev && !same(was.position, prev);
    const position = dragged ? was.position : n.position;
    if (
      was &&
      was.data === n.data &&
      was.style === n.style &&
      Boolean(was.selected) === isSelected &&
      same(was.position, position)
    )
      return was;
    return { ...n, position, selected: isSelected };
  });
}
