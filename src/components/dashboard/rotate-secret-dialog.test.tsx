import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import {
  RotateSecretDialog,
  generateWebhookSecret,
  webhookSecretError,
} from './rotate-secret-dialog';

const field = () => screen.getByLabelText('New secret') as HTMLInputElement;

describe('generateWebhookSecret', () => {
  it('makes 32 random bytes as 43 base64url characters', () => {
    const a = generateWebhookSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateWebhookSecret()).not.toBe(a);
  });
});

describe('webhookSecretError', () => {
  it('accepts 1 to 256 characters, as apid does', () => {
    expect(webhookSecretError('x')).toBeUndefined();
    expect(webhookSecretError('x'.repeat(256))).toBeUndefined();
    expect(webhookSecretError('')).toMatch(/1 to 256/);
    expect(webhookSecretError('x'.repeat(257))).toMatch(/1 to 256/);
  });
});

describe('RotateSecretDialog', () => {
  it('opens with a generated secret and sends exactly what is shown', async () => {
    const onRotate = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<RotateSecretDialog name="errors-high" onRotate={onRotate} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Rotate the secret for errors-high?' }));
    const shown = field().value;
    expect(shown).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await userEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));
    expect(onRotate).toHaveBeenCalledWith(shown);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('generates another secret on request and accepts a pasted one', async () => {
    const onRotate = vi.fn().mockResolvedValue(undefined);
    render(<RotateSecretDialog name="hook" onRotate={onRotate} onClose={vi.fn()} />);
    const first = field().value;
    await userEvent.click(screen.getByRole('button', { name: 'Generate another' }));
    expect(field().value).not.toBe(first);
    await userEvent.clear(field());
    await userEvent.type(field(), 'from-my-secret-manager');
    await userEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));
    expect(onRotate).toHaveBeenCalledWith('from-my-secret-manager');
  });

  it('refuses an empty or over-long secret without calling the API', async () => {
    const onRotate = vi.fn();
    render(<RotateSecretDialog name="hook" onRotate={onRotate} onClose={vi.fn()} />);
    await userEvent.clear(field());
    await userEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));
    expect(screen.getByText('Enter a secret of 1 to 256 characters.')).toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    await userEvent.click(field());
    await userEvent.paste('x'.repeat(257));
    await userEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));
    expect(onRotate).not.toHaveBeenCalled();
  });

  it('keeps the dialog and the secret when the API refuses', async () => {
    const onRotate = vi.fn().mockRejectedValue(
      new ApiError({
        status: 422,
        code: 'validation_failed',
        title: 'webhook_secret is too long',
      })
    );
    const onClose = vi.fn();
    render(<RotateSecretDialog name="hook" onRotate={onRotate} onClose={onClose} />);
    const shown = field().value;
    await userEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(field().value).toBe(shown);
    expect(onClose).not.toHaveBeenCalled();
  });
});
