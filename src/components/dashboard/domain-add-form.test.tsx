import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const addDomain = vi.fn();
const toast = vi.fn();
const refetchEnvironments = vi.fn();
const state = vi.hoisted(() => ({
  plan: 'pro' as string,
  wildcardAccess: 'on' as string,
  membership: 'ready' as 'ready' | 'pending' | 'error',
  environments: ['production', 'staging', 'pr-preview'] as string[] | Error,
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock('@/lib/api/queries', () => ({
  useApps: () => ({
    data: [
      { id: 'app-1', slug: 'shop-api' },
      { id: 'app-2', slug: 'solo' },
    ],
    error: null,
    refetch: vi.fn(),
  }),
  useAddDomain: () => ({ mutateAsync: addDomain, isPending: false }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { id: 'acct-1', plan: state.plan } }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: (id: string) => ({
    access: id === 'wildcard-domains' ? state.wildcardAccess : 'on',
    refresh: vi.fn(),
  }),
}));
vi.mock('@/lib/api/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/projects')>()),
  useProjectMembership: () => ({
    projectOfApp: new Map([['shop-api', 'acme-shop']]),
    state: state.membership,
    list: { error: state.membership === 'error' ? new Error('projects offline') : null },
    details: [],
    retry: vi.fn(),
  }),
  useProjectEnvironments: (_account: string, slug: string) =>
    state.environments instanceof Error
      ? {
          data: undefined,
          isPending: false,
          error: state.environments,
          refetch: refetchEnvironments,
        }
      : {
          data: slug
            ? state.environments.map((name) => ({ slug: name, project_id: 'p', id: name }))
            : undefined,
          isPending: !slug,
          error: null,
          refetch: refetchEnvironments,
        },
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { DomainAddForm } = await import('./domain-add-form');

beforeEach(() => {
  state.plan = 'pro';
  state.wildcardAccess = 'on';
  state.membership = 'ready';
  state.environments = ['production', 'staging', 'pr-preview'];
  addDomain.mockReset().mockResolvedValue({ domain: 'x', txt_record: 'verify' });
  toast.mockReset();
  refetchEnvironments.mockReset();
});
afterEach(cleanup);

const hostname = () => screen.getByRole('textbox', { name: 'Hostname' });
const kind = (name: 'Single host' | 'Wildcard') =>
  userEvent.click(
    within(screen.getByRole('group', { name: 'Domain kind' })).getByRole('button', { name })
  );
const submit = () => userEvent.click(screen.getByRole('button', { name: 'Add domain' }));

describe('DomainAddForm, single host', () => {
  it('binds a hostname to the chosen app, app-wide', async () => {
    render(<DomainAddForm />);
    await userEvent.type(hostname(), 'api.example.com');
    await submit();
    await waitFor(() =>
      expect(addDomain).toHaveBeenCalledWith({ domain: 'api.example.com', app_id: 'app-1' })
    );
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
    expect(hostname()).toHaveValue('');
  });

  it('points a typed wildcard at the Wildcard kind instead of sending it', async () => {
    render(<DomainAddForm />);
    await userEvent.type(hostname(), '*.example.com');
    await submit();
    expect(hostname()).toHaveAccessibleDescription(/choose wildcard/i);
    expect(addDomain).not.toHaveBeenCalled();
  });
});

describe('DomainAddForm, wildcard', () => {
  it('adds *.zone on Pro, from the zone or the whole wildcard pasted in', async () => {
    render(<DomainAddForm />);
    await kind('Wildcard');
    expect(screen.getByText('*.')).toBeInTheDocument();
    expect(screen.getByText(/at most 40 in any 7 days/i)).toBeInTheDocument();
    await userEvent.type(hostname(), '*.Example.com');
    await submit();
    await waitFor(() =>
      expect(addDomain).toHaveBeenCalledWith({ domain: '*.example.com', app_id: 'app-1' })
    );
  });

  it('needs a zone of at least two labels', async () => {
    render(<DomainAddForm />);
    await kind('Wildcard');
    await userEvent.type(hostname(), 'com');
    await submit();
    expect(hostname()).toHaveAccessibleDescription(/like example\.com/i);
    expect(addDomain).not.toHaveBeenCalled();
  });

  it.each(['free', 'hobby'])(
    'explains that %s does not include wildcards and links plans',
    async (plan) => {
      state.plan = plan;
      render(<DomainAddForm />);
      await kind('Wildcard');
      expect(screen.getByText(/included in pro and scale/i)).toHaveTextContent(
        new RegExp(`on the ${plan} plan`, 'i')
      );
      expect(screen.getByRole('link', { name: 'Compare plans' })).toHaveAttribute(
        'href',
        '/dashboard/plans'
      );
      expect(screen.getByRole('button', { name: 'Add domain' })).toBeDisabled();
      expect(hostname()).toBeDisabled();
    }
  );

  it('says so when wildcard domains are not released to the account', async () => {
    state.wildcardAccess = 'off';
    render(<DomainAddForm />);
    await kind('Wildcard');
    expect(screen.getByText(/not available to this account/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add domain' })).toBeDisabled();
  });

  it('explains the plan refusal inline when the API answers wildcard_domains_not_allowed', async () => {
    addDomain.mockRejectedValue(
      new ApiError({
        status: 402,
        code: 'wildcard_domains_not_allowed',
        title: 'Wildcard domains unavailable on this plan',
      })
    );
    render(<DomainAddForm />);
    await kind('Wildcard');
    await userEvent.type(hostname(), 'example.com');
    await submit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/included in pro and scale/i);
    expect(within(alert).getByText('wildcard_domains_not_allowed')).toBeInTheDocument();
    expect(within(alert).getByRole('link', { name: 'Compare plans' })).toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('DomainAddForm, environment', () => {
  const environment = () => screen.getByRole('combobox', { name: 'Environment' });

  it('offers the project environments of a project app, without the preview scope', () => {
    render(<DomainAddForm />);
    const options = within(environment())
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['App-wide', 'production', 'staging']);
    expect(environment()).toBeEnabled();
  });

  it('binds the domain to the chosen environment and says what that means', async () => {
    render(<DomainAddForm />);
    await userEvent.selectOptions(environment(), 'staging');
    expect(screen.getByText(/only staging’s active release set/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be the app’s default/i)).toBeInTheDocument();
    await userEvent.type(hostname(), 'staging.example.com');
    await submit();
    await waitFor(() =>
      expect(addDomain).toHaveBeenCalledWith({
        domain: 'staging.example.com',
        app_id: 'app-1',
        environment: 'staging',
      })
    );
  });

  it('has no environment to offer for an app outside every project, and drops a stale choice', async () => {
    render(<DomainAddForm />);
    await userEvent.selectOptions(environment(), 'staging');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Routes to' }), 'solo');
    expect(environment()).toBeDisabled();
    expect(environment()).toHaveDisplayValue('Not in a project');
    await userEvent.type(hostname(), 'solo.example.com');
    await submit();
    await waitFor(() =>
      expect(addDomain).toHaveBeenCalledWith({ domain: 'solo.example.com', app_id: 'app-2' })
    );
  });

  it('waits for project membership rather than guessing', () => {
    state.membership = 'pending';
    render(<DomainAddForm />);
    expect(environment()).toBeDisabled();
    expect(environment()).toHaveDisplayValue('Loading…');
  });

  it('shows a failed environment read with a retry, and still allows app-wide', async () => {
    state.environments = new Error('environments offline');
    render(<DomainAddForm />);
    expect(environment()).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('environments offline');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetchEnvironments).toHaveBeenCalled();
    await userEvent.type(hostname(), 'api.example.com');
    await submit();
    await waitFor(() =>
      expect(addDomain).toHaveBeenCalledWith({ domain: 'api.example.com', app_id: 'app-1' })
    );
  });

  it('explains an environment the API no longer finds, and reads the environments again', async () => {
    addDomain.mockRejectedValue(
      new ApiError({ status: 404, code: 'not_found', title: 'Environment not found' })
    );
    render(<DomainAddForm />);
    await userEvent.selectOptions(environment(), 'staging');
    await userEvent.type(hostname(), 'staging.example.com');
    await submit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/staging is no longer an environment of acme-shop/i);
    expect(refetchEnvironments).toHaveBeenCalled();
  });
});
