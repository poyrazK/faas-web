import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliCommand } from './cli-command';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CliCommand', () => {
  it('shows the command after a prompt marker that screen readers and selection skip', () => {
    render(<CliCommand command="gregale jobs rm nightly" />);

    expect(screen.getByText('gregale jobs rm nightly')).toBeInTheDocument();
    const prompt = screen.getByText('$');
    expect(prompt).toHaveAttribute('aria-hidden', 'true');
    expect(prompt).toHaveClass('select-none');
  });

  it('copies the command alone, without the $ prompt', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CliCommand command="gregale jobs rm nightly" label="Delete this workload" />);

    await user.click(screen.getByRole('button', { name: 'Copy: Delete this workload' }));

    expect(writeText).toHaveBeenCalledWith('gregale jobs rm nightly');
    await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
  });

  it('names the copy button after the command when there is no label', () => {
    render(<CliCommand command="gregale domains set-default api.example.com" />);

    expect(
      screen.getByRole('button', { name: 'Copy: gregale domains set-default api.example.com' })
    ).toBeInTheDocument();
  });

  it('names the copy button after copyLabel while the visible caption stays the label', () => {
    render(
      <CliCommand
        command="gregale jobs rm nightly"
        label="Delete this workload. The CLI does not ask first."
        copyLabel="delete command for nightly"
      />
    );

    expect(screen.getByText('Delete this workload. The CLI does not ask first.')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Copy: delete command for nightly' })
    ).toBeInTheDocument();
  });
});
