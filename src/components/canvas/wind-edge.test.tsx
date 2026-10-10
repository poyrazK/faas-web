import { render } from '@testing-library/react';
import { Position, ReactFlowProvider, type EdgeProps } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { WindEdge, type WindFlowEdge } from './wind-edge';

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
} as unknown as EdgeProps<WindFlowEdge>;

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

  it('never parks a particle at the origin waiting for its turn', () => {
    const { container } = render(
      <ReactFlowProvider>
        <svg>
          <WindEdge {...props} data={{ requests24h: 500_000 }} />
        </svg>
      </ReactFlowProvider>
    );
    const begins = [...container.querySelectorAll('animateMotion')].map((m) =>
      m.getAttribute('begin')
    );
    expect(begins.length).toBeGreaterThan(1);
    for (const b of begins) expect(b === '-0.00s' || b?.startsWith('-')).toBe(true);
  });
});
