import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const useAlertPresets = vi.fn();
const enable = vi.fn();
const test_ = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useAlertPresets: () => useAlertPresets() as unknown,
  useEnableAlertPreset: () => ({ mutateAsync: enable, isPending: false }),
  useTestAlertPreset: () => ({ mutateAsync: test_, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { AlertPresets } = await import('./alert-presets');

const PRESET = {
  id: 'p1',
  name: 'error_rate_2pct',
  display_name: 'Error rate exceeds 2%',
  description: 'Fires when the rolling 15-minute error rate exceeds 2%.',
  category: 'reliability',
  metric: 'error_rate_pct',
  comparison: 'gt',
  threshold: 2,
  window_spec: '15m',
  default_cooldown_minutes: 15,
  minimum_plan: 'hobby',
  enabled_in_catalog: true,
};

beforeEach(() => {
  enable.mockReset().mockResolvedValue({});
  test_.mockReset().mockResolvedValue({ status: 'sent' });
  toast.mockReset();
  useAlertPresets.mockReturnValue({ data: [PRESET], isPending: false, error: null });
});

async function openEnable() {
  await userEvent.click(screen.getByRole('button', { name: /enable/i }));
}

describe('AlertPresets', () => {
  it('describes the preset and the condition it encodes', () => {
    render(<AlertPresets slug="api" />);
    expect(screen.getByText('Error rate exceeds 2%')).toBeInTheDocument();
    expect(screen.getByText(/error_rate_pct > 2 over 15m/)).toBeInTheDocument();
  });

  it('needs a webhook before it will enable', async () => {
    render(<AlertPresets slug="api" />);
    await openEnable();
    expect(screen.getByRole('button', { name: /^enable preset$/i })).toBeDisabled();
    expect(enable).not.toHaveBeenCalled();
  });

  it('enables with the webhook it was given', async () => {
    render(<AlertPresets slug="api" />);
    await openEnable();
    await userEvent.type(screen.getByLabelText(/webhook url/i), 'https://hooks.example.com/a');
    await userEvent.type(screen.getByLabelText(/secret/i), 'shh');
    await userEvent.click(screen.getByRole('button', { name: /^enable preset$/i }));
    await waitFor(() =>
      expect(enable).toHaveBeenCalledWith({
        slug: 'api',
        name: 'error_rate_2pct',
        body: { webhook_url: 'https://hooks.example.com/a', webhook_secret: 'shh', enabled: true },
      })
    );
  });

  it('explains a plan gate rather than showing a bare error', async () => {
    enable.mockRejectedValue(
      new ApiError({ status: 402, code: 'plan_required', title: 'Upgrade required' })
    );
    render(<AlertPresets slug="api" />);
    await openEnable();
    await userEvent.type(screen.getByLabelText(/webhook url/i), 'https://hooks.example.com/a');
    await userEvent.type(screen.getByLabelText(/secret/i), 'shh');
    await userEvent.click(screen.getByRole('button', { name: /^enable preset$/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/hobby/i) })
    );
  });

  it('tells you to enable a preset before testing it', async () => {
    test_.mockRejectedValue(new ApiError({ status: 404, code: 'not_found', title: 'No rule' }));
    render(<AlertPresets slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /send test/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/enable/i) })
    );
  });

  it('reports a webhook that refused the test', async () => {
    test_.mockRejectedValue(
      new ApiError({ status: 502, code: 'dispatch_failed', title: 'Bad gateway' })
    );
    render(<AlertPresets slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /send test/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
    );
  });
});
