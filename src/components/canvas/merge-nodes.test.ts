import { describe, expect, it } from 'vitest';
import { mergeNodes } from './merge-nodes';

type N = {
  id: string;
  position: { x: number; y: number };
  data: object;
  selected?: boolean;
  style?: object;
};
const data = {};
const node = (id: string, x: number, y: number): N => ({ id, position: { x, y }, data });

describe('mergeNodes', () => {
  it('moves a node the layout moved, when nobody dragged it', () => {
    const current = [node('a', 0, 0)];
    const laid = new Map([['a', { x: 0, y: 0 }]]);
    const [a] = mergeNodes(current, [node('a', 0, 72)], undefined, laid);
    expect(a.position).toEqual({ x: 0, y: 72 });
  });

  it('keeps a dragged node where it was dropped', () => {
    const current = [node('a', 300, 40)];
    const laid = new Map([['a', { x: 0, y: 0 }]]);
    const [a] = mergeNodes(current, [node('a', 0, 72)], undefined, laid);
    expect(a.position).toEqual({ x: 300, y: 40 });
  });

  it('keeps identity when nothing about a node changed', () => {
    const current = [node('a', 0, 0)];
    const laid = new Map([['a', { x: 0, y: 0 }]]);
    const [a] = mergeNodes(current, [node('a', 0, 0)], undefined, laid);
    expect(a).toBe(current[0]);
  });

  it('places a new node at its layout position and marks the selection', () => {
    const [b] = mergeNodes([], [node('b', 10, 20)], 'b', new Map());
    expect(b.position).toEqual({ x: 10, y: 20 });
    expect(b.selected).toBe(true);
  });

  it('drops a style the page no longer sets, even when the data is the same', () => {
    const hidden = { ...node('a', 0, 0), style: { opacity: 0 } };
    const laid = new Map([['a', { x: 0, y: 0 }]]);
    const [a] = mergeNodes([hidden], [node('a', 0, 0)], undefined, laid);
    expect(a.style).toBeUndefined();
  });
});
