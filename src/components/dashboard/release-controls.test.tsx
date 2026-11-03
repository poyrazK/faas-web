import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { Deployment } from '@/lib/api/queries';

const updateTraffic = vi.fn();
const serving = vi.fn();
const refetchServing = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useUpdateDeploymentMinInstances: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateDeploymentTraffic: () => ({ mutateAsync: updateTraffic, isPending: false }),
}));
vi.mock('@/lib/api/deployment-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/deployment-detail')>()),
  useServingRows: (...args: unknown[]) => serving(...args) as unknown,
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

const { DeploymentControls } = await import('./release-controls');

const CANDIDATE = 'd2c4e6f8-0000-4000-8000-000000000001';
const SERVING = 'b1b2b3b4-0000-4000-8000-000000000043';

function deployment(over: Partial<Deployment> = {}): Deployment {
  return {
    id: CANDIDATE,
    app_id: 'a1',
    image_digest: 'sha256:abc',
    kind: 'github',
    status: 'live',
    revision: 44,
    traffic_percent: 0,
    created_at: '2026-10-31T10:00:00Z',
    ...over,
  };
}

const read = (rows: Deployment[], complete = true) => ({
  data: { rows, complete },
  error: null,
  isPending: false,
  isFetching: false,
  refetch: refetchServing,
});

function setWeight(value: string) {
  fireEvent.change(screen.getByRole('spinbutton', { name: /traffic weight/i }), {
    target: { value },
  });
}

beforeEach(() => {
  updateTraffic.mockReset().mockResolvedValue({});
  refetchServing.mockReset().mockResolvedValue({});
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
  serving
    .mockReset()
    .mockReturnValue(read([deployment({ id: SERVING, revision: 43, traffic_percent: 100 })]));
});

describe('traffic weight', () => {
  it('pins the release that serves all traffic when the weight changes', async () => {
    render(<DeploymentControls slug="alpha" deployment={deployment()} version="v44" />);
    expect(serving).toHaveBeenCalledWith('alpha', 'default', { enabled: true });
    expect(screen.getByText(/serves all traffic now/i)).toHaveTextContent('v43');
    setWeight('25');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]);
    expect(updateTraffic).toHaveBeenCalledWith({
      id: CANDIDATE,
      traffic_percent: 25,
      expected_serving_deployment_id: SERVING,
    });
  });

  it('pins "nothing else serves" when no other release holds traffic', async () => {
    serving.mockReturnValue(read([]));
    render(
      <DeploymentControls
        slug="alpha"
        deployment={deployment({ traffic_percent: 100 })}
        version="v44"
      />
    );
    setWeight('50');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]);
    expect(updateTraffic).toHaveBeenCalledWith({
      id: CANDIDATE,
      traffic_percent: 50,
      expected_serving_deployment_id: '',
    });
  });

  it.each([
    [
      'a split',
      read([
        deployment({ id: SERVING, revision: 43, traffic_percent: 60 }),
        deployment({ id: 'c3', revision: 42, traffic_percent: 40 }),
      ]),
    ],
    ['an incomplete read', read([], false)],
  ])('sends no pin for %s', async (_label, value) => {
    serving.mockReturnValue(value);
    render(<DeploymentControls slug="alpha" deployment={deployment()} version="v44" />);
    setWeight('25');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]);
    expect(updateTraffic).toHaveBeenCalledWith({ id: CANDIDATE, traffic_percent: 25 });
  });

  it('says another release took over when the pin is stale, and offers a refresh', async () => {
    updateTraffic.mockRejectedValue(
      new ApiError({ status: 409, code: 'traffic_serving_changed', title: 'Changed' })
    );
    render(<DeploymentControls slug="alpha" deployment={deployment()} version="v44" />);
    setWeight('25');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/another release took over/i);
    expect(alert).toHaveTextContent(/v43 no longer serves all/i);
    expect(toast).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetchServing).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('lists the bindings blockers when an enforced release policy refuses the weight', async () => {
    updateTraffic.mockRejectedValue(
      new ApiError({
        status: 409,
        code: 'bindings_check_failed',
        title: 'Bindings check failed',
        bindings_check: {
          app: 'alpha',
          scope: 'default',
          deployment_id: CANDIDATE,
          checked_at: '2026-11-03T10:00:00Z',
          inventory_generated_at: '2026-11-03T10:00:00Z',
          max_verification_age: '10m0s',
          allow_unsupported: false,
          passed: false,
          coverage: 'partial',
          bindings: [],
          runtime: [],
          issues: [],
          blockers: [
            {
              code: 'queue_completion_unverified',
              binding: 'orders',
              message: 'Handler completion has not been verified.',
            },
          ],
          warnings: [],
        },
      })
    );
    render(<DeploymentControls slug="alpha" deployment={deployment()} version="v44" />);
    setWeight('25');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/bindings check failed\. traffic is unchanged/i);
    expect(alert).toHaveTextContent(/before the traffic change/i);
    const item = within(alert).getByRole('listitem');
    expect(item).toHaveTextContent('orders');
    expect(item).toHaveTextContent(/queue canary/i);
    expect(toast).not.toHaveBeenCalled();
  });

  it('does not read what serves for a release that cannot take traffic', () => {
    render(
      <DeploymentControls
        slug="alpha"
        deployment={deployment({ status: 'superseded' })}
        version="v44"
      />
    );
    expect(serving).toHaveBeenCalledWith('alpha', 'default', { enabled: false });
    expect(screen.queryByText(/serves all traffic/i)).not.toBeInTheDocument();
  });
});
