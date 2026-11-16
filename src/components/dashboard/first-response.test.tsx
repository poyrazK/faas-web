import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '@/lib/api/queries';
import { FirstResponse } from './first-response';

const mocks = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('@/lib/api/deployment-response', async (original) => ({
  ...(await original<typeof import('@/lib/api/deployment-response')>()),
  checkDeploymentResponse: mocks.check,
}));
const deployment = { id: 'a'.repeat(32), app_id: 'b'.repeat(32), status: 'live' };
const app = {
  id: deployment.app_id,
  slug: 'hello-app',
  visibility: 'public',
  require_authn: false,
} as App;
const response = {
  app_id: app.id,
  deployment_id: deployment.id,
  scope: 'default',
  instance_id: 'c'.repeat(32),
  http_status: 200,
  body: 'OK',
  body_truncated: false,
};
const props = { slug: app.slug, endpoint: 'https://api.example', app, deployment };
beforeEach(() => {
  mocks.check.mockReset();
  mocks.check.mockResolvedValue(response);
});

describe('deployment response verification', () => {
  it('waits for an explicit action and pins the exact deployment', async () => {
    render(<FirstResponse {...props} />);
    expect(mocks.check).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Verify response' }));
    expect(
      await screen.findByRole('heading', { name: 'Application response verified' })
    ).toBeVisible();
    expect(mocks.check).toHaveBeenCalledWith(app.slug, deployment, '/', expect.any(AbortSignal));
    expect(screen.getByText('OK')).toBeVisible();
    expect(screen.getByText(/Public access has not been verified/)).toBeVisible();
  });
  it.each([401, 403, 404, 500])(
    'does not treat an API envelope with application HTTP %s as success',
    async (http_status) => {
      mocks.check.mockResolvedValue({ ...response, http_status });
      render(<FirstResponse {...props} />);
      await userEvent.click(screen.getByRole('button', { name: 'Verify response' }));
      expect(await screen.findByText(new RegExp('HTTP ' + http_status))).toBeVisible();
      expect(
        screen.queryByRole('heading', { name: 'Application response verified' })
      ).not.toBeInTheDocument();
    }
  );
  it('offers private testing without a public link or access change', async () => {
    render(<FirstResponse {...props} app={{ ...app, require_authn: true }} />);
    expect(screen.getByText(/Private endpoint:/)).toHaveTextContent('401');
    expect(screen.queryByRole('link', { name: 'Open public request URL' })).not.toBeInTheDocument();
    expect(screen.getByText(/gregale release verify/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Verify response' }));
    expect(
      await screen.findByRole('heading', { name: 'Application response verified' })
    ).toBeVisible();
  });
  it('offers an internal app the same account check without requiring an endpoint', async () => {
    render(<FirstResponse {...props} endpoint={null} app={{ ...app, visibility: 'internal' }} />);
    expect(screen.getByText(/Internal app:/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Verify response' }));
    expect(
      await screen.findByRole('heading', { name: 'Application response verified' })
    ).toBeVisible();
  });
  it('reports unsupported verification without falling back to invocation', async () => {
    mocks.check.mockRejectedValue(new Error('Deployment verification is unavailable'));
    render(<FirstResponse {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Verify response' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
  });
  it('cancels a stale request when its path changes', async () => {
    let resolve!: (value: unknown) => void;
    mocks.check.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    render(<FirstResponse {...props} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Verify response' }));
    const signal = mocks.check.mock.calls[0][3];
    await user.clear(screen.getByLabelText('Request path'));
    await user.type(screen.getByLabelText('Request path'), '//other.example');
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve(response);
    });
    expect(
      screen.queryByRole('heading', { name: 'Application response verified' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify response' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Open public request URL' })).not.toBeInTheDocument();
  });
  it('does not offer an anonymous URL for consumer-key-protected apps', () => {
    render(<FirstResponse {...props} app={{ ...app, consumer_auth_mode: 'required' }} />);
    expect(screen.queryByRole('link', { name: 'Open public request URL' })).not.toBeInTheDocument();
    expect(screen.getByText(/Private endpoint:/)).toBeVisible();
  });
  it('guides workers to logs instead of sending an HTTP check', () => {
    render(<FirstResponse {...props} app={{ ...app, workload_class: 'worker' }} />);
    expect(screen.getByRole('heading', { name: 'Check workload activity' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Verify response' })).not.toBeInTheDocument();
    expect(mocks.check).not.toHaveBeenCalled();
  });
});
