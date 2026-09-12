import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallCommand } from './install-command';

const writeText = vi.fn<(text: string) => Promise<void>>();
const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  vi.useRealTimers();
  if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

describe.each(['inline', 'standalone'] as const)('%s install copy', (variant) => {
  function mount() {
    const view = render(<InstallCommand variant={variant} />);
    const button = screen.getByRole('button', {
      name: 'Copy install command: npm install -g gregale',
    });
    return { ...view, button };
  }

  it('waits for the clipboard write before confirming with visible Copied text', async () => {
    let complete!: () => void;
    writeText.mockReturnValue(new Promise<void>((resolve) => (complete = resolve)));
    const { button } = mount();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Copied', { exact: true })).not.toBeInTheDocument();
    await act(async () => complete());
    expect(writeText).toHaveBeenCalledWith('npm install -g gregale');
    expect(screen.getByText('Copied', { exact: true })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Copied to clipboard');
    expect(button).toHaveAttribute('aria-busy', 'false');
  });

  it('restores the command after the confirmation hold', async () => {
    const { button } = mount();
    await act(async () => fireEvent.click(button));
    expect(screen.getByRole('status')).toHaveTextContent('Copied to clipboard');
    await act(async () => vi.advanceTimersByTimeAsync(2600));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByText('npm install -g gregale')).toBeInTheDocument();
  });

  it('reports clipboard rejection without showing a success confirmation', async () => {
    writeText.mockRejectedValue(new Error('Permission denied'));
    const { button } = mount();
    await act(async () => fireEvent.click(button));
    expect(screen.getByRole('status')).toHaveTextContent(/couldn’t copy/i);
    expect(screen.queryByText('Copied', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText('npm install -g gregale')).toBeInTheDocument();
    writeText.mockResolvedValue(undefined);
    await act(async () => fireEvent.click(button));
    expect(screen.getByRole('status')).toHaveTextContent('Copied to clipboard');
  });

  it('ignores duplicate presses while the clipboard request is pending', async () => {
    let complete!: () => void;
    writeText.mockReturnValue(new Promise<void>((resolve) => (complete = resolve)));
    const { button } = mount();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledTimes(1);
    await act(async () => complete());
  });

  it('copies again and gives the latest confirmation a full hold', async () => {
    const { button } = mount();
    await act(async () => fireEvent.click(button));
    await act(async () => vi.advanceTimersByTimeAsync(1600));
    await act(async () => fireEvent.click(button));
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('Copied to clipboard');
    await act(async () => vi.advanceTimersByTimeAsync(1600));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('does not start a feedback timer when a pending copy resolves after unmount', async () => {
    let complete!: () => void;
    writeText.mockReturnValue(new Promise<void>((resolve) => (complete = resolve)));
    const { button, unmount } = mount();
    fireEvent.click(button);
    unmount();
    const timers = vi.getTimerCount();
    await act(async () => complete());
    expect(vi.getTimerCount()).toBe(timers);
  });
});
