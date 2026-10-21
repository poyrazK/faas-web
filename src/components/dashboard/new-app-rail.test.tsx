import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NewAppHeader, NewAppRail, NewAppReviewGrid } from './new-app-rail';
import type { SummaryRow } from './new-app-summary';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const rows: SummaryRow[] = [
  { key: 'source', label: 'Source', value: 'Git repository' },
  { key: 'name', label: 'Name', value: 'a-forty-character-app-name-that-is-long', mono: true },
];

describe('NewAppHeader', () => {
  it('heads the page and links back to the apps', () => {
    render(<NewAppHeader title="New app" description="Choose a source." back />);
    expect(screen.getByRole('heading', { level: 1, name: 'New app' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /All apps/ })).toHaveAttribute(
      'href',
      '/dashboard/apps'
    );
  });
});

describe('NewAppRail', () => {
  it('is a named landmark that marks the current step and the ones done', () => {
    render(<NewAppRail step={1} rows={[]} />);
    expect(screen.getByRole('complementary', { name: 'New app progress' })).toBeInTheDocument();
    const steps = within(screen.getByRole('list', { name: 'App creation steps' })).getAllByRole(
      'listitem'
    );
    expect(steps.map((s) => s.textContent?.replace(/\d+/g, '').trim())).toEqual([
      'Source',
      'Configure',
      'Review',
    ]);
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
    expect(steps[0]).toHaveAttribute('data-state', 'done');
    expect(steps[2]).toHaveAttribute('data-state', 'upcoming');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('names the chosen source under step one, and shows one step for self-contained sources', () => {
    const { rerender } = render(<NewAppRail step={0} rows={[]} sourceLabel="Template" />);
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Template');
    rerender(<NewAppRail step={0} rows={[]} stepCount={1} sourceLabel="Container image" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('scrolls itself when taller than the screen', () => {
    render(<NewAppRail step={0} rows={rows} />);
    expect(screen.getByRole('complementary')).toHaveClass('lg:overflow-y-auto');
  });

  it('hides the steps when there is no step (Import)', () => {
    render(<NewAppRail step={undefined} rows={[]} />);
    expect(screen.queryByRole('list', { name: 'App creation steps' })).not.toBeInTheDocument();
  });

  it('lists only what is known, and nothing at all when the list is empty', () => {
    const { rerender } = render(<NewAppRail step={0} rows={rows} />);
    // "Source" is also a step label, so read the row from its value.
    expect(screen.getByText('Git repository').previousElementSibling).toHaveTextContent('Source');
    expect(screen.getByText("What you'll get")).toBeInTheDocument();
    rerender(<NewAppRail step={2} rows={[]} />);
    expect(screen.queryByText("What you'll get")).not.toBeInTheDocument();
  });

  it('wraps long values instead of overflowing', () => {
    render(<NewAppRail step={0} rows={rows} />);
    expect(screen.getByText('a-forty-character-app-name-that-is-long')).toHaveClass('break-words');
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

  it('gives Name and the URL one wide hero cell, so a URL does not break mid-word', () => {
    render(<NewAppReviewGrid rows={all} />);
    const hero = screen.getByText('Name').closest('[data-hero]');
    expect(hero).not.toBeNull();
    expect(hero).toContainElement(screen.getByText('Public URL'));
    expect(hero).toHaveClass('sm:col-span-2');
  });

  it('heads the review', () => {
    render(<NewAppReviewGrid rows={all} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Review' })).toBeInTheDocument();
  });
});
