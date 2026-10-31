import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyableId } from './copyable-id';

function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CopyableId', () => {
  it('shows a 16-character value in full', () => {
    const value = 'a'.repeat(16);
    render(<CopyableId value={value} label="bucket ID" />);
    expect(screen.getByText(value)).toBeInTheDocument();
  });

  it('truncates a 17-character value to 12 characters and an ellipsis, keeping the full value in title', () => {
    const value = '0123456789abcdefg';
    render(<CopyableId value={value} label="bucket ID" />);
    const text = screen.getByText('0123456789ab…');
    expect(text).toHaveAttribute('title', value);
    expect(screen.queryByText(value)).not.toBeInTheDocument();
  });

  it('shows everything when full is set', () => {
    const value = '0123456789abcdef0123456789abcdef';
    render(<CopyableId value={value} label="bucket ID" full />);
    expect(screen.getByText(value)).toBeInTheDocument();
  });

  it('lets a full value wrap instead of clipping it', () => {
    const value = '0123456789abcdef0123456789abcdef';
    render(<CopyableId value={value} label="bucket ID" full />);
    expect(screen.getByText(value)).not.toHaveClass('truncate');
  });

  it('honours displayLength for any value longer than it', () => {
    const value = '0123456789abcdef0123456789abcdef01234567';
    render(<CopyableId value={value} label="commit" displayLength={7} />);
    expect(screen.getByText('0123456…')).toHaveAttribute('title', value);
  });

  it('shows a value no longer than displayLength unchanged', () => {
    render(<CopyableId value="abcdefg" label="commit" displayLength={7} />);
    expect(screen.getByText('abcdefg')).toBeInTheDocument();
  });

  it('copies the full value, not the truncated text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    mockClipboard(writeText);
    const value = '0123456789abcdef0123456789abcdef';
    render(<CopyableId value={value} label="bucket ID" />);

    await user.click(screen.getByRole('button', { name: `Copy: bucket ID ${value}` }));

    expect(writeText).toHaveBeenCalledWith(value);
  });

  it('names the button after the label and the full value', () => {
    render(<CopyableId value="db_123" label="database ID" />);
    expect(screen.getByRole('button', { name: 'Copy: database ID db_123' })).toBeInTheDocument();
  });

  it('does not pass the press on to a clickable parent, such as a table row', async () => {
    const onRow = vi.fn();
    const user = userEvent.setup();
    mockClipboard(vi.fn().mockResolvedValue(undefined));
    render(
      <div onClick={onRow}>
        <CopyableId value="db_123" label="database ID" />
      </div>
    );
    await user.click(screen.getByRole('button', { name: 'Copy: database ID db_123' }));
    expect(onRow).not.toHaveBeenCalled();
  });

  it('still lets a press on the ID text reach a clickable parent', async () => {
    const onRow = vi.fn();
    const user = userEvent.setup();
    render(
      <div onClick={onRow}>
        <CopyableId value="db_123" label="database ID" />
      </div>
    );
    await user.click(screen.getByText('db_123'));
    expect(onRow).toHaveBeenCalledTimes(1);
  });
});
