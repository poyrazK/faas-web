import type React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const flow = vi.hoisted(() => ({
  fitView: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  zoomTo: vi.fn(),
}));
vi.mock('@xyflow/react', () => ({
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useReactFlow: () => flow,
  useStore: (sel: (s: { transform: [number, number, number] }) => unknown) =>
    sel({ transform: [0, 0, 0.84] }),
}));
const { CanvasToolbar } = await import('./canvas-toolbar');

describe('CanvasToolbar', () => {
  it('shows the live zoom and resets it on click', () => {
    render(<CanvasToolbar items={[]} onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom 84%, reset to 100%' }));
    expect(flow.zoomTo).toHaveBeenCalledWith(1, { duration: 240 });
  });

  it('opens the finder on / and the wizard on n', () => {
    const onNew = vi.fn();
    render(<CanvasToolbar items={[]} onPick={vi.fn()} onNew={onNew} />);
    fireEvent.keyDown(window, { key: '/' });
    expect(screen.getByRole('combobox', { name: 'Jump to a node' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'n' });
    expect(onNew).toHaveBeenCalled();
  });

  it('does not hijack / or n while typing', () => {
    const onNew = vi.fn();
    render(
      <>
        <input aria-label="elsewhere" />
        <CanvasToolbar items={[]} onPick={vi.fn()} onNew={onNew} />
      </>
    );
    const other = screen.getByLabelText('elsewhere');
    other.focus();
    fireEvent.keyDown(other, { key: 'n' });
    fireEvent.keyDown(other, { key: '/' });
    expect(onNew).not.toHaveBeenCalled();
    expect(screen.queryByRole('combobox', { name: 'Jump to a node' })).not.toBeInTheDocument();
  });
});
