import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { RepoPicker } from './repo-picker';

const mocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  error: null as Error | null,
  data: [] as { id: number; full_name: string; default_branch: string; private: boolean }[],
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { id: 'owner', github_install_id: '42' } }),
}));
vi.mock('@/lib/api/queries', () => ({
  useInstallRepos: () => ({ ...mocks, isPending: false, isFetching: false }),
}));
afterEach(() => {
  mocks.error = null;
  mocks.data = [];
  vi.clearAllMocks();
});

it('explains a failed repository read and offers a retry while preserving manual input', async () => {
  mocks.error = new ApiError({
    code: 'github_login_required',
    title: 'GitHub sign-in required',
    status: 403,
  });
  render(<RepoPicker value="poyrazK/imgpipe" onChange={vi.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Refresh your GitHub connection');
  expect(screen.getByLabelText('Repository')).toHaveValue('poyrazK/imgpipe');
  await userEvent.click(screen.getByRole('button', { name: 'Reload repositories' }));
  expect(mocks.refetch).toHaveBeenCalledOnce();
});

it('distinguishes an empty repository list from an error', () => {
  render(<RepoPicker value="" onChange={vi.fn()} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('no accessible repositories');
});

it('uses the selected repository’s actual default branch', async () => {
  mocks.data = [{ id: 1, full_name: 'poyrazK/imgpipe', default_branch: 'master', private: false }];
  const onChange = vi.fn();
  render(<RepoPicker value="" onChange={onChange} />);
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'Repository' }),
    'poyrazK/imgpipe'
  );
  expect(onChange).toHaveBeenCalledWith('poyrazK/imgpipe', 'master');
});

it('shows a value the installation does not list instead of the placeholder', () => {
  mocks.data = [{ id: 1, full_name: 'poyrazK/imgpipe', default_branch: 'master', private: false }];
  render(
    <RepoPicker value="acme-corp/api-gateway" unlistedNote="bound repository" onChange={vi.fn()} />
  );
  const select = screen.getByRole('combobox', { name: 'Repository' });
  expect(select).toHaveValue('acme-corp/api-gateway');
  expect(screen.getByRole('option', { selected: true })).toHaveTextContent(
    'acme-corp/api-gateway (bound repository)'
  );
});

it('names an unlisted value even without a caller note', () => {
  mocks.data = [{ id: 1, full_name: 'poyrazK/imgpipe', default_branch: 'master', private: false }];
  render(<RepoPicker value="acme-corp/api-gateway" onChange={vi.fn()} />);
  expect(screen.getByRole('option', { selected: true })).toHaveTextContent(
    'acme-corp/api-gateway (not listed for this installation)'
  );
});

it('does not duplicate a value that is listed', () => {
  mocks.data = [{ id: 1, full_name: 'poyrazK/imgpipe', default_branch: 'master', private: false }];
  render(<RepoPicker value="poyrazK/imgpipe" unlistedNote="bound repository" onChange={vi.fn()} />);
  expect(screen.getAllByRole('option', { name: /poyrazK\/imgpipe/ })).toHaveLength(1);
});
