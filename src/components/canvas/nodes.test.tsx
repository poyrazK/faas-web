import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider, type Node, type NodeProps } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';
import { AppNode, DomainNode, GhostNode } from './nodes';
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

  it('says why metrics are missing instead of printing a number', () => {
    wrap(
      <AppNode
        {...props({
          ...base,
          metrics: 'unavailable',
          metricsWhy: 'plan',
          requests24h: undefined,
          p95Ms: undefined,
        })}
      />
    );
    expect(screen.getByText('Metrics on Hobby')).toBeInTheDocument();
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
  });

  it('names the kind of error', () => {
    wrap(<AppNode {...props({ ...base, phase: 'error', errorRatePct: 3.24 })} />);
    expect(screen.getByText('Error · 3.2% errors')).toBeInTheDocument();
  });

  it('breathes when parked, and says so', () => {
    const { container } = wrap(<AppNode {...props({ ...base, phase: 'parked' })} />);
    expect(screen.getByText('Parked · snapshot')).toBeInTheDocument();
    expect(container.querySelector('[data-breathing]')).not.toBeNull();
  });

  it('offers a retry on the node whose connections failed', () => {
    const onRetry = vi.fn();
    wrap(<AppNode {...props({ ...base, connections: 'error', onRetry })} />);
    expect(screen.getByText(/connections unavailable/i)).toBeInTheDocument();
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(onRetry).toHaveBeenCalled();
  });

  it('keeps connectors visible while selected, for touch', () => {
    const onConnect = vi.fn();
    wrap(<AppNode {...props({ ...base, onConnect })} selected />);
    for (const b of screen.getAllByRole('button', { name: /api|resource|traffic/i })) {
      expect(b).toHaveAttribute('data-shown', 'true');
    }
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

describe('AppNode · first deploy', () => {
  it('shows the rail and the latest build line while building', () => {
    wrap(
      <AppNode
        {...props({
          ...base,
          launch: {
            slug: 'acme-api',
            source: 'git',
            repo: 'acme/api',
            ref: 'main',
            stage: 'building',
            step: 2,
            logLine: '→ npm ci',
          },
        })}
      />
    );
    expect(screen.getByText('Building')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Deploy progress' })).toHaveAttribute(
      'aria-valuenow',
      '2'
    );
    expect(screen.getByText('→ npm ci')).toBeInTheDocument();
  });

  it('names the source under the rail until the build has output', () => {
    wrap(
      <AppNode
        {...props({
          ...base,
          launch: {
            slug: 'acme-api',
            source: 'git',
            repo: 'acme/api',
            ref: 'main',
            stage: 'queued',
            step: 1,
          },
        })}
      />
    );
    expect(screen.getByText('acme/api@main')).toBeInTheDocument();
  });

  it('waits for a CLI deploy, breathing', () => {
    const { container } = wrap(
      <AppNode
        {...props({
          ...base,
          launch: { slug: 'acme-api', source: 'cli', stage: 'waiting', step: 0 },
        })}
      />
    );
    expect(screen.getByText('Waiting for first deploy')).toBeInTheDocument();
    expect(screen.getByText('Run gregale deploy to go live')).toBeInTheDocument();
    expect(container.querySelector('[data-breathing]')).not.toBeNull();
  });

  it('fails in place with the cause, logs and retry', () => {
    const onLaunchAction = vi.fn();
    wrap(
      <AppNode
        {...props({
          ...base,
          onLaunchAction,
          launch: {
            slug: 'acme-api',
            source: 'git',
            stage: 'failed',
            step: 0,
            deploymentId: 'd1',
            failure: "Cannot find module './db'",
          },
        })}
      />
    );
    expect(screen.getByText("Cannot find module './db'")).toBeInTheDocument();
    screen.getByRole('button', { name: 'Retry' }).click();
    screen.getByRole('button', { name: 'View logs' }).click();
    expect(onLaunchAction.mock.calls).toEqual([['retry'], ['logs']]);
  });

  it('offers no logs for a build that was never submitted', () => {
    wrap(
      <AppNode
        {...props({
          ...base,
          onLaunchAction: vi.fn(),
          launch: {
            slug: 'acme-api',
            source: 'git',
            stage: 'failed',
            step: 0,
            failure: 'Build was not submitted: Connect GitHub first.',
          },
        })}
      />
    );
    expect(screen.queryByRole('button', { name: 'View logs' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('says when status cannot be read, offering only a re-read', () => {
    const onLaunchAction = vi.fn();
    wrap(
      <AppNode
        {...props({
          ...base,
          onLaunchAction,
          launch: {
            slug: 'acme-api',
            source: 'git',
            stage: 'unavailable',
            step: 0,
            failure: 'Not found',
          },
        })}
      />
    );
    expect(screen.getByText('Status unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View logs' })).not.toBeInTheDocument();
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(onLaunchAction).toHaveBeenCalledWith('retry');
  });

  it('offers no second retry while one is in flight', () => {
    wrap(
      <AppNode
        {...props({
          ...base,
          onLaunchAction: vi.fn(),
          launch: { slug: 'acme-api', source: 'git', stage: 'failed', step: 0, retrying: true },
        })}
      />
    );
    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
  });

  it('announces status changes politely', () => {
    wrap(
      <AppNode
        {...props({
          ...base,
          launch: { slug: 'acme-api', source: 'git', stage: 'queued', step: 1 },
        })}
      />
    );
    expect(screen.getByText('Queued')).toHaveAttribute('aria-live', 'polite');
  });
});

describe('GhostNode', () => {
  it('reads as a suggestion and can be dismissed', () => {
    const onPick = vi.fn();
    const onDismiss = vi.fn();
    wrap(
      <GhostNode
        {...props({ kind: 'domain', label: '+ Add a domain', next: true, onPick, onDismiss })}
      />
    );
    screen.getByRole('button', { name: '+ Add a domain' }).click();
    screen.getByRole('button', { name: 'Not now' }).click();
    expect(onPick).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it('opts out of pane panning, so a press is a click and not a pan', () => {
    const { container } = wrap(
      <GhostNode
        {...props({ kind: 'cron', label: '+ Schedule a cron', next: false, onPick: vi.fn() })}
      />
    );
    expect(container.querySelector('.nopan')).not.toBeNull();
  });
});
