import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ProjectWorkloads } from './project-workloads';
it('does not invent workload rows for an empty durable project', () => {
  render(<ProjectWorkloads workloads={[]} />);
  expect(screen.getByText('This project has no workloads.')).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
