import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ProjectWorkloads } from './project-workloads';
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
it('does not invent workload rows for an empty durable project', () => {
  render(<ProjectWorkloads workloads={[]} />);
  expect(screen.getByText('This project has no workloads.')).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
it('lists the services each workload declares it calls, and says where they come from', () => {
  // depends_on: declared service bindings, sorted; omitted when none
  // (faas handlers_projects.go:215, ADR-20261026193018).
  render(
    <ProjectWorkloads
      workloads={[
        { slug: 'web', workload_name: 'web', status: 'active', depends_on: ['auth', 'billing'] },
        { slug: 'auth', workload_name: 'auth', status: 'active' },
      ]}
    />
  );
  const table = screen.getByRole('table', { name: 'Project workloads' });
  expect(within(table).getByRole('columnheader', { name: 'Calls' })).toBeInTheDocument();
  const [web, auth] = within(table).getAllByRole('row').slice(1);
  expect(within(web).getByText('auth, billing')).toBeInTheDocument();
  expect(within(auth).getByText('None declared')).toBeInTheDocument();
  expect(screen.getByText(/depends_on/)).toBeInTheDocument();
  expect(screen.getByText(/\.gregale\/project\.yaml/)).toBeInTheDocument();
});
