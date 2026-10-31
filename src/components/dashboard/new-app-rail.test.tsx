import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NewAppHeader, NewAppReviewGrid } from './new-app-rail';
import type { SummaryRow } from './new-app-summary';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const rows: SummaryRow[] = [
  { key: 'source', label: 'Source', value: 'Git repository' },
  { key: 'name', label: 'Name', value: 'a-forty-character-app-name-that-is-long', mono: true },
];

describe('NewAppHeader', () => {
  it('heads the first page and links back to the apps', () => {
    render(<NewAppHeader title="New app" description="Choose how to start." back="apps" />);
    expect(screen.getByRole('heading', { level: 1, name: 'New app' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /All apps/ })).toHaveAttribute(
      'href',
      '/dashboard/apps'
    );
  });

  // With no rail, each page names its own step and holds the one way back.
  it('names a later step, says where it falls, and goes back one step', async () => {
    const onBack = vi.fn();
    render(
      <NewAppHeader
        step="Step 2 of 3"
        title="Configure"
        description="Name it and choose how it runs."
        back={{ label: 'Setup', onBack }}
      />
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Configure' })).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /All apps/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Back to Setup' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('can have no way back at all (onboarding)', () => {
    render(<NewAppHeader title="Deploy your first app" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('NewAppReviewGrid', () => {
  const all: SummaryRow[] = [
    ...rows,
    { key: 'memory', label: 'Memory', value: '256 MB', mono: true },
    { key: 'url', label: 'Public URL', value: 'https://api.gregale.app', mono: true },
  ];

  it('pairs every label with its value, Name and URL first', () => {
    render(<NewAppReviewGrid rows={all} />);
    expect(screen.getByText('Public URL').nextElementSibling).toHaveTextContent(
      'https://api.gregale.app'
    );
    const labels = screen.getAllByRole('term').map((t) => t.textContent);
    expect(labels.slice(0, 2)).toEqual(['Name', 'Public URL']);
    expect(labels).toContain('Memory');
  });

  it('wraps long values', () => {
    render(<NewAppReviewGrid rows={all} />);
    screen.getAllByRole('definition').forEach((d) => expect(d).toHaveClass('break-words'));
  });

  it('leads with Name and the URL together, so a URL does not break mid-word', () => {
    render(<NewAppReviewGrid rows={all} />);
    const hero = screen.getByText('Name').closest('[data-hero]');
    expect(hero).not.toBeNull();
    expect(hero).toContainElement(screen.getByText('Public URL'));
    expect(hero).toHaveClass('flex-wrap');
  });

  it('heads the summary (the page itself is titled Review)', () => {
    render(<NewAppReviewGrid rows={all} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Summary' })).toBeInTheDocument();
  });
});
