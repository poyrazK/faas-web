import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
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
  it('heads the page and links back to the apps', () => {
    render(<NewAppHeader title="New app" description="Choose a source." back />);
    expect(screen.getByRole('heading', { level: 1, name: 'New app' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /All apps/ })).toHaveAttribute(
      'href',
      '/dashboard/apps'
    );
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
