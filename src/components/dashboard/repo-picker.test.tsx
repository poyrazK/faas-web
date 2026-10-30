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

  const many = (n: number, owner: (i: number) => string = () => 'acme-corp') =>
    Array.from({ length: n }, (_, i) => ({
      id: i,
      full_name: `${owner(i)}/service-${String(i).padStart(2, '0')}`,
      default_branch: 'main',
      private: false,
    }));
  const values = () => screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value);

  // Forty repositories at once is a wall, not a choice: a long list shows a
  // handful, pins the chosen one on top, and leads with search.
  it('shows a handful of a long list, the chosen one first, and says how many are hidden', () => {
    mocks.data = many(40);
    renderList('acme-corp/service-31');
    expect(values()).toEqual([
      'acme-corp/service-31',
      'acme-corp/service-00',
      'acme-corp/service-01',
      'acme-corp/service-02',
      'acme-corp/service-03',
    ]);
    expect(screen.getByRole('searchbox', { name: 'Search repositories' })).toHaveAttribute(
      'placeholder',
      'Search 40 repositories'
    );
    expect(screen.getByText(/5 of 40 shown/)).toBeInTheDocument();
  });

  it('narrows by search, still capped, keeping the chosen repository in view', async () => {
    mocks.data = many(40);
    renderList('acme-corp/service-31');
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Search repositories' }),
      'service-1'
    );
    expect(values()).toEqual([
      'acme-corp/service-31',
      'acme-corp/service-10',
      'acme-corp/service-11',
      'acme-corp/service-12',
      'acme-corp/service-13',
    ]);
    expect(screen.getByText(/5 of 11 matches/)).toBeInTheDocument();
  });

  it('picks the top match on Enter, and moves into the list on ArrowDown', async () => {
    mocks.data = many(40);
    const onChange = vi.fn();
    renderList('', onChange);
    const search = screen.getByRole('searchbox', { name: 'Search repositories' });
    await userEvent.type(search, 'service-27{Enter}');
    expect(onChange).toHaveBeenCalledWith('acme-corp/service-27', 'main');
    await userEvent.clear(search);
    await userEvent.type(search, '{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'acme-corp/service-00' })).toHaveFocus();
  });

  it('shows the whole list on request', async () => {
    mocks.data = many(40);
    renderList();
    await userEvent.click(screen.getByRole('button', { name: 'Show all 40' }));
    expect(screen.getAllByRole('radio')).toHaveLength(40);
  });

  it('filters by owner when the repositories span several', async () => {
    mocks.data = many(12, (i) => (i % 3 ? 'acme-corp' : 'poyrazK'));
    renderList();
    const owners = screen.getByRole('group', { name: 'Owner' });
    await userEvent.click(within(owners).getByRole('button', { name: /poyrazK\s*4/ }));
    expect(values()).toEqual([
      'poyrazK/service-00',
      'poyrazK/service-03',
      'poyrazK/service-06',
      'poyrazK/service-09',
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
