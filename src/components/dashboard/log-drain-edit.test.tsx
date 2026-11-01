import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogDrain } from '@/lib/api/log-drains';
import { ApiError } from '@/lib/api/errors';

const state = vi.hoisted(() => ({
  update: vi.fn(),
  toast: vi.fn(),
  kinds: ['http_json', 'otlp', 'datadog'] as string[],
}));
vi.mock('@/lib/api/log-drains', () => ({
  useUpdateLogDrain: () => ({ mutateAsync: state.update, isPending: false }),
}));
vi.mock('@/lib/api/log-drain-capabilities', () => ({ useLogDrainKinds: () => state.kinds }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: state.toast }) }));

const { EditLogDrain } = await import('./log-drain-edit');

const drain: LogDrain = {
  id: 'ld-1',
  app_id: 'app-1',
  account_id: 'acct',
  kind: 'http_json',
  target_url: 'https://logs.example.com/ingest',
  auth_header_masked: '***',
  enabled: true,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

beforeEach(() => {
  state.update.mockReset().mockResolvedValue(drain);
  state.toast.mockReset();
  state.kinds = ['http_json', 'otlp', 'datadog'];
});

describe('EditLogDrain', () => {
  it('patches only the changed field and never echoes the stored header', async () => {
    const onClose = vi.fn();
    render(<EditLogDrain slug="api" drain={drain} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Edit log destination' });
    expect(within(dialog).getByLabelText('Auth header (optional)')).toHaveValue('');
    const url = within(dialog).getByLabelText('Endpoint URL');
    await userEvent.clear(url);
    await userEvent.type(url, 'https://new.example.com/ingest');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith({
        id: 'ld-1',
        body: { target_url: 'https://new.example.com/ingest' },
      })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('closes without a request when nothing changed', async () => {
    const onClose = vi.fn();
    render(<EditLogDrain slug="api" drain={drain} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(state.update).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('switches a drain to Datadog only with an API key', async () => {
    render(<EditLogDrain slug="api" drain={drain} onClose={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText('Format'), 'datadog');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByText('Enter your Datadog API key.')).toBeInTheDocument();
    expect(state.update).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Datadog API key'), 'key-1');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith({
        id: 'ld-1',
        body: {
          kind: 'datadog',
          target_url: 'https://http-intake.logs.datadoghq.com/api/v2/logs',
          auth_header: 'DD-API-KEY: key-1',
        },
      })
    );
  });

  it('explains a refusal in the dialog, branching on the code', async () => {
    state.update.mockRejectedValue(
      new ApiError({
        status: 503,
        code: 'datadog_integration_unavailable',
        title: 'Datadog integration unavailable',
        detail: 'the Datadog integration is not enabled for this deployment',
      })
    );
    const onClose = vi.fn();
    render(<EditLogDrain slug="api" drain={drain} onClose={onClose} />);
    await userEvent.selectOptions(screen.getByLabelText('Format'), 'datadog');
    await userEvent.type(screen.getByLabelText('Datadog API key'), 'key-1');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Datadog destinations are not available on this installation/
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
