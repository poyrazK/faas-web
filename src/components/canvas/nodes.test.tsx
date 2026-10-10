import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider, type Node, type NodeProps } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';
import { AppNode, DomainNode } from './nodes';
import type { AppData } from './topology';

const base: AppData = {
  kind: 'app',
  slug: 'acme-api',
  phase: 'running',
  metrics: 'ready',
  connections: 'ready',
  requests24h: 12_400,
  p95Ms: 84,
};
const props = <T extends Record<string, unknown>>(data: T) =>
  ({
    id: 'n',
    data,
    selected: false,
    type: 'app',
    dragging: false,
    zIndex: 0,
    isConnectable: false,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    selectable: true,
    deletable: false,
    draggable: true,
  }) as unknown as NodeProps<Node<T>>;
const wrap = (ui: ReactNode) => render(<ReactFlowProvider>{ui}</ReactFlowProvider>);

describe('AppNode', () => {
  it('shows the state as text and the real scalars', () => {
    wrap(<AppNode {...props(base)} />);
    expect(screen.getByText('acme-api')).toBeInTheDocument();
    expect(screen.getByText('Serving')).toBeInTheDocument();
    expect(screen.getByText('12.4k')).toBeInTheDocument();
    expect(screen.getByText('84ms')).toBeInTheDocument();
  });

  it('AppNode never prints a number it was not given', () => {
    wrap(
      <AppNode
        {...props({ ...base, metrics: 'unavailable', requests24h: undefined, p95Ms: undefined })}
      />
    );
    expect(screen.queryByText(/req\/24h/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
  });

  it('breathes when parked, and says so', () => {
    const { container } = wrap(<AppNode {...props({ ...base, phase: 'parked' })} />);
    expect(screen.getByText('Parked · snapshot')).toBeInTheDocument();
    expect(container.querySelector('[data-breathing]')).not.toBeNull();
  });

  it('says when its connections could not load', () => {
    wrap(<AppNode {...props({ ...base, connections: 'error' })} />);
    expect(screen.getByText(/couldn’t load connections/i)).toBeInTheDocument();
  });

  it('offers both connectors with accessible names', () => {
    const onConnect = vi.fn();
    wrap(<AppNode {...props({ ...base, onConnect })} />);
    screen.getByRole('button', { name: 'Add something that sends traffic into acme-api' }).click();
    screen.getByRole('button', { name: 'Connect acme-api to a resource' }).click();
    expect(onConnect.mock.calls).toEqual([['in'], ['out']]);
  });

  it('truncates a long slug but keeps it readable on hover', () => {
    const slug = 'a-very-long-application-slug-that-will-not-fit';
    wrap(<AppNode {...props({ ...base, slug })} />);
    expect(screen.getByText(slug)).toHaveAttribute('title', slug);
  });
});

describe('DomainNode', () => {
  it('reads pending DNS until verified', () => {
    wrap(
      <DomainNode
        {...props({
          kind: 'domain',
          domain: 'api.acme.dev',
          verified: false,
          txtRecord: 'x',
          appSlug: 'acme-api',
        })}
      />
    );
    expect(screen.getByText('Pending DNS')).toBeInTheDocument();
  });
});
