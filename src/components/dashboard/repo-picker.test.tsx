import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('the list variant', () => {
  const repos = [
    { id: 1, full_name: 'acme-corp/storefront', default_branch: 'main', private: true },
    { id: 2, full_name: 'poyrazK/imgpipe', default_branch: 'master', private: false },
  ];
  const renderList = (value = '', onChange = vi.fn()) =>
    render(
      <>
        <span id="repo-label">Repository</span>
        <RepoPicker
          variant="list"
          labelledBy="repo-label"
          name="repository"
          value={value}
          onChange={onChange}
        />
      </>
    );

  it('lists every repository as a choice, with its privacy and default branch', () => {
    mocks.data = repos;
    renderList();
    const group = screen.getByRole('radiogroup', { name: 'Repository' });
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
    const storefront = screen.getByRole('radio', { name: /acme-corp\/storefront/ });
    expect(storefront.closest('label')).toHaveTextContent('Private');
    expect(storefront.closest('label')).toHaveTextContent('main');
    expect(
      screen.getByRole('radio', { name: /poyrazK\/imgpipe/ }).closest('label')
    ).not.toHaveTextContent('Private');
  });

  it('reports the picked repository with its default branch, and marks the current one', async () => {
    mocks.data = repos;
    const onChange = vi.fn();
    renderList('acme-corp/storefront', onChange);
    expect(screen.getByRole('radio', { name: /acme-corp\/storefront/ })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: /poyrazK\/imgpipe/ }));
    expect(onChange).toHaveBeenCalledWith('poyrazK/imgpipe', 'master');
  });

  it('offers a filter once the list is long, keeping the chosen repository in view', async () => {
    mocks.data = Array.from({ length: 9 }, (_, i) => ({
      id: i,
      full_name: `acme-corp/service-${i}`,
      default_branch: 'main',
      private: false,
    }));
    renderList('acme-corp/service-8');
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Filter repositories' }),
      'service-3'
    );
    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual([
      'acme-corp/service-3',
      'acme-corp/service-8',
    ]);
  });

  it('has no filter for a short list', () => {
    mocks.data = repos;
    renderList();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('falls back to the typed field when the list cannot be read', () => {
    mocks.error = new Error('boom');
    render(<RepoPicker variant="list" value="a/b" onChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'Repository' })).toHaveValue('a/b');
  });
});
