import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PresetPicker } from './alert-presets';
import type { components } from '@/lib/api/schema';

const preset = {
  id: '0123456789abcdef0123456789abcdef',
  name: 'error_rate_2pct',
  display_name: 'Error rate exceeds 2%',
  description: 'Fires when the rolling 15-minute error rate exceeds 2%.',
  category: 'reliability',
  metric: 'error_rate_pct',
  comparison: 'gt',
  threshold: 2,
  window_spec: '15m',
  default_cooldown_minutes: 15,
  minimum_plan: 'free',
  enabled_in_catalog: true,
} as unknown as components['schemas']['AlertPresetResponse'];

/**
 * A preset is picked, given a webhook, and enabled — the catalog's
 * (metric, comparison, threshold, window) sextuple never has to be typed.
 */
describe('PresetPicker', () => {
  it('groups presets by category and enables one with a webhook', async () => {
    const onEnable = vi.fn();
    const user = userEvent.setup();
    render(<PresetPicker presets={[preset]} onEnable={onEnable} busy={false} />);
    expect(screen.getByText('reliability')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /error rate exceeds 2%/i }));
    await user.type(screen.getByLabelText('Webhook URL'), 'https://hooks.example.com/alerts');
    await user.type(screen.getByLabelText('Webhook secret'), 'sixteen-characters!!');
    await user.click(screen.getByRole('button', { name: 'Enable preset' }));
    expect(onEnable).toHaveBeenCalledWith('error_rate_2pct', {
      webhook_url: 'https://hooks.example.com/alerts',
      webhook_secret: 'sixteen-characters!!',
      enabled: true,
    });
  });
});
