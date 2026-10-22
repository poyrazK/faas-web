import { render, renderHook, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevLayoutSwitch, NewAppStage, NewAppStrip, useNewAppLayout } from './new-app-layout';

afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe('useNewAppLayout', () => {
  it('starts on Track, remembers a choice in dev', () => {
    const { result, unmount } = renderHook(() => useNewAppLayout());
    expect(result.current[0]).toBe('track');
    act(() => result.current[1]('fold'));
    expect(result.current[0]).toBe('fold');
    unmount();
    expect(renderHook(() => useNewAppLayout()).result.current[0]).toBe('fold');
  });

  it('ignores a stored choice outside dev', () => {
    localStorage.setItem('gregale.dev.newAppLayout', 'fold');
    vi.stubEnv('DEV', false);
    expect(renderHook(() => useNewAppLayout()).result.current[0]).toBe('track');
  });
});

describe('DevLayoutSwitch', () => {
  it('offers both layouts in dev and reports a choice', async () => {
    const onChange = vi.fn();
    render(<DevLayoutSwitch layout="track" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'Track' })).toBeChecked();
    // Bottom centre: bottom-left covered the sidebar's Collapse.
    expect(screen.getByRole('radiogroup')).toHaveClass('left-1/2', '-translate-x-1/2');
    await userEvent.click(screen.getByRole('radio', { name: 'Fold' }));
    expect(onChange).toHaveBeenCalledWith('fold');
  });

  it('is absent outside dev', () => {
    vi.stubEnv('DEV', false);
    const { container } = render(<DevLayoutSwitch layout="track" onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('NewAppStage', () => {
  it('Track: shows only the current station and a named way back', async () => {
    const onBack = vi.fn();
    render(
      <NewAppStage layout="track" station="setup" label="setup" back={{ label: 'Sources', onBack }}>
        <p>setup fields</p>
      </NewAppStage>
    );
    expect(screen.getByText('setup fields')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to Sources' }));
    expect(onBack).toHaveBeenCalled();
  });

  // A station that lingered through an exit animation left two stations'
  // controls in the page at once, and a quick click hit the old one.
  it('swaps stations at once, never holding the old one while the new slides in', () => {
    const { rerender } = render(
      <NewAppStage layout="track" station="sources" label="sources">
        <p>grid</p>
      </NewAppStage>
    );
    rerender(
      <NewAppStage
        layout="track"
        station="setup"
        label="setup"
        back={{ label: 'Sources', onBack: vi.fn() }}
      >
        <p>setup fields</p>
      </NewAppStage>
    );
    expect(screen.queryByText('grid')).not.toBeInTheDocument();
    expect(screen.getByText('setup fields')).toBeInTheDocument();
  });

  it('Track: no way back from the first station', () => {
    render(
      <NewAppStage layout="track" station="sources" label="sources">
        <p>grid</p>
      </NewAppStage>
    );
    expect(screen.queryByRole('button', { name: /Back to/ })).not.toBeInTheDocument();
  });

  it('Fold: puts the strip beside every station after Sources', () => {
    const { rerender } = render(
      <NewAppStage
        layout="fold"
        station="sources"
        label="sources"
        strip={<nav aria-label="strip" />}
      >
        <p>grid</p>
      </NewAppStage>
    );
    expect(screen.queryByRole('navigation', { name: 'strip' })).not.toBeInTheDocument();
    rerender(
      <NewAppStage
        layout="fold"
        station="configure"
        label="configure"
        strip={<nav aria-label="strip" />}
      >
        <p>configure</p>
      </NewAppStage>
    );
    expect(screen.getByRole('navigation', { name: 'strip' })).toBeInTheDocument();
  });
});

describe('NewAppStage focus', () => {
  // The control that moved the wizard on leaves with its station; focus goes
  // to the new station, named, instead of falling to the page body.
  it('moves focus to the new station when the focused control went with the old one', () => {
    const { rerender } = render(
      <NewAppStage layout="track" station="sources" label="Choose a source">
        <button type="button">Template</button>
      </NewAppStage>
    );
    screen.getByRole('button', { name: 'Template' }).focus();
    rerender(
      <NewAppStage layout="track" station="setup" label="Template">
        <p>catalog</p>
      </NewAppStage>
    );
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Template' }));
  });

  it('leaves focus alone when it survived the change, as on the strip', () => {
    const strip = <button type="button">Empty</button>;
    const { rerender } = render(
      <NewAppStage layout="fold" station="setup" label="Git repository" strip={strip}>
        <p>git</p>
      </NewAppStage>
    );
    screen.getByRole('button', { name: 'Empty' }).focus();
    rerender(
      <NewAppStage layout="fold" station="configure" label="Configure" strip={strip}>
        <p>configure</p>
      </NewAppStage>
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Empty' }));
  });

  it('does not steal focus on first render', () => {
    render(
      <NewAppStage layout="track" station="sources" label="Choose a source">
        <p>sources</p>
      </NewAppStage>
    );
    expect(document.activeElement).toBe(document.body);
  });
});

describe('NewAppStage persistent content', () => {
  // Import's form outlives station changes (its draft must survive), yet it
  // belongs in the station's column, beside the way back.
  it('places persistent content in the station column', () => {
    render(
      <NewAppStage
        layout="track"
        station="setup"
        label="Import"
        back={{ label: 'Sources', onBack: vi.fn() }}
        persistent={<p>import form</p>}
      >
        {null}
      </NewAppStage>
    );
    expect(screen.getByText('import form').closest('[role="region"]')).toBe(
      screen.getByRole('region', { name: 'Import' })
    );
  });
});

describe('NewAppStrip', () => {
  it('lies flat as a row of glyphs in a narrow column', () => {
    render(<NewAppStrip selected="git" onSelect={vi.fn()} />);
    expect(screen.getByRole('navigation', { name: 'Sources' })).toHaveClass(
      'flex-row',
      '@[40rem]:flex-col'
    );
  });

  it('lists the six sources with the selection pressed, and switches', async () => {
    const onSelect = vi.fn();
    render(<NewAppStrip selected="template" onSelect={onSelect} />);
    const nav = screen.getByRole('navigation', { name: 'Sources' });
    const buttons = nav.querySelectorAll('button');
    expect(buttons).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Template' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onSelect).toHaveBeenCalledWith('import');
  });
});
