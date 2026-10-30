import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NewAppStage } from './new-app-layout';

describe('NewAppStage', () => {
  // The way back lives in the page header now; the stage holds only the station.
  it('shows only the current station, with no way back of its own', () => {
    render(
      <NewAppStage station="setup" label="setup">
        <p>setup fields</p>
      </NewAppStage>
    );
    expect(screen.getByText('setup fields')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  // A station that lingered through an exit animation left two stations'
  // controls in the page at once, and a quick click hit the old one.
  it('swaps stations at once, never holding the old one while the new slides in', () => {
    const { rerender } = render(
      <NewAppStage station="sources" label="sources">
        <p>choices</p>
      </NewAppStage>
    );
    rerender(
      <NewAppStage station="setup" label="setup">
        <p>setup fields</p>
      </NewAppStage>
    );
    expect(screen.queryByText('choices')).not.toBeInTheDocument();
    expect(screen.getByText('setup fields')).toBeInTheDocument();
  });
});

describe('NewAppStage focus', () => {
  // The control that moved the wizard on leaves with its station; focus goes
  // to the new station, named, instead of falling to the page body.
  it('moves focus to the new station when the focused control went with the old one', () => {
    const { rerender } = render(
      <NewAppStage station="sources" label="Choose a source">
        <button type="button">Template</button>
      </NewAppStage>
    );
    screen.getByRole('button', { name: 'Template' }).focus();
    rerender(
      <NewAppStage station="setup" label="Template">
        <p>catalog</p>
      </NewAppStage>
    );
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Template' }));
  });

  it('leaves focus alone when it survived the change', () => {
    const { rerender } = render(
      <>
        <button type="button">Elsewhere</button>
        <NewAppStage station="setup" label="Git repository">
          <p>git</p>
        </NewAppStage>
      </>
    );
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    rerender(
      <>
        <button type="button">Elsewhere</button>
        <NewAppStage station="configure" label="Configure">
          <p>configure</p>
        </NewAppStage>
      </>
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }));
  });

  it('does not steal focus on first render', () => {
    render(
      <NewAppStage station="sources" label="Choose a source">
        <p>sources</p>
      </NewAppStage>
    );
    expect(document.activeElement).toBe(document.body);
  });
});

describe('NewAppStage persistent content', () => {
  // Import's form outlives station changes (its draft must survive), yet it
  // belongs in the station's column, under the way back.
  it('places persistent content in the station column', () => {
    render(
      <NewAppStage station="setup" label="Import" persistent={<p>import form</p>}>
        {null}
      </NewAppStage>
    );
    expect(screen.getByText('import form').closest('[role="region"]')).toBe(
      screen.getByRole('region', { name: 'Import' })
    );
  });
});
