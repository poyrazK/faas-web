import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Route as Storage } from './dashboard.storage';

vi.mock('@/components/dashboard/object-storage', () => ({
  ObjectStorage: () => <h2>Buckets</h2>,
}));

it('is about buckets only: app capacity lives on the Usage page', () => {
  const Page = Storage.options.component!;
  render(<Page />);
  expect(screen.queryByText('App capacity')).not.toBeInTheDocument();
  expect(screen.queryByText(/app capacity/i)).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Buckets' })).toBeInTheDocument();
});
