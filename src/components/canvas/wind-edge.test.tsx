import { render } from '@testing-library/react';
import { Position, ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { WindEdge } from './wind-edge';

const props = {
  id: 'e',
  source: 'a',
  target: 'b',
  sourceX: 0,
  sourceY: 0,
  targetX: 100,
  targetY: 0,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  data: { requests24h: 1200 },
} as never;

describe('WindEdge', () => {
  it('keeps a hoverable hit area even though React Flow marks the edge inactive', () => {
    const { container } = render(
      <ReactFlowProvider>
        <svg>
          <WindEdge {...props} />
        </svg>
      </ReactFlowProvider>
    );
    const hit = container.querySelector('path[stroke="transparent"]') as SVGPathElement;
    expect(hit.style.pointerEvents).toBe('stroke');
  });
});
