import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Handlers } from '@/test/monetization';
import { withRouter } from '@/test/router';

const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
const access = vi.hoisted(() => ({ value: 'on', ai: 'on' }));
vi.mock('@/lib/api/workspace-apps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/workspace-apps')>()),
  useWorkspaceTarget: () => workspace,
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: (id: string) => ({
    access: id === 'ai-gateway' ? access.ai : access.value,
    capability: undefined,
    refresh: vi.fn(),
  }),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct' } }) }));

const { IntegrationsSection } = await import('./integrations-section');

const STRIPE = {
  id: 'h1',
  name: 'Stripe',
  origin: 'https://api.stripe.com',
  daily_request_limit: 10_000,
};
const OPENAI = {
  id: 'a1',
  name: 'OpenAI',
  origin: 'https://api.openai.com',
  ai_provider: 'openai',
  daily_request_limit: null,
  ai_daily_token_limit: 2_000_000,
  ai_daily_cost_limit_millicents: 2_000_000,
};

let tagLimits: { tag: string; daily_cost_limit_millicents: number }[];
function api(extra: Handlers = {}) {
  return routeApi({
    'GET /v1/outbound/integrations': () => ({ items: [STRIPE, OPENAI] }),
    'GET /v1/outbound/integrations/{integration}/usage': ({ params }) =>
      params?.path?.integration === 'h1'
        ? { daily_request_count: 10_000, daily_request_limit: 10_000 }
        : { daily_request_count: 40, daily_request_limit: null },
    'GET /v1/outbound/integrations/{integration}/ai-usage': () => ({
      daily_token_count: 500_000,
      daily_token_limit: 2_000_000,
      daily_cost_millicents: 400_000,
      daily_cost_limit_millicents: 2_000_000,
      items: [],
    }),
    'GET /v1/outbound/integrations/{integration}/ai-tag-limits': () => ({ limits: tagLimits }),
    'PUT /v1/outbound/integrations/{integration}/ai-tag-limits': ({ body }) => {
      tagLimits = (body as { limits: typeof tagLimits }).limits;
      return undefined;
    },
    ...extra,
  });
}

beforeEach(() => {
  workspace.org = null;
  access.value = 'on';
  access.ai = 'on';
  tagLimits = [{ tag: 'feature=search', daily_cost_limit_millicents: 500_000 }];
});
afterEach(() => vi.restoreAllMocks());

const show = () => renderWithProviders(withRouter(<IntegrationsSection />));

describe('Integrations and AI', () => {
  it('is folded by default and reads no usage until opened (those reads need MFA)', async () => {
    const spies = api();
    const user = userEvent.setup();
    show();
    const summary = await screen.findByText(/2 integrations/);
    expect(summary.closest('details')).not.toHaveAttribute('open');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const usagePaths = () =>
      spies.GET.mock.calls.map(([path]) => String(path)).filter((p) => /usage/.test(p));
    expect(usagePaths()).toEqual([]);
    await user.click(summary);
    await waitFor(() => expect(summary).toHaveTextContent('2 integrations · 1 limit reached'));
    expect(usagePaths().length).toBeGreaterThan(0);
  });

  it('lists each integration’s limits, with meters where use is reported', async () => {
    api();
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByText(/2 integrations/));
    const stripe = screen.getByRole('region', { name: 'Stripe' });
    await waitFor(() =>
      expect(within(stripe).getByRole('meter', { name: 'Requests a day used' })).toHaveAttribute(
        'aria-valuenow',
        '100'
      )
    );
    const openai = screen.getByRole('region', { name: 'OpenAI' });
    expect(openai).toHaveTextContent('No daily request limit.');
    await waitFor(() =>
      expect(openai).toHaveTextContent('Calls stop once today’s tokens reach 2,000,000.')
    );
    expect(openai).toHaveTextContent('Calls stop at $20.00 of cost a day.');
    expect(within(stripe).getByRole('link', { name: 'Change' })).toHaveAttribute(
      'href',
      '/dashboard/integrations'
    );
  });

  it('reads tag limits only when asked, and saves the whole list', async () => {
    const spies = api();
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByText(/2 integrations/));
    const openai = screen.getByRole('region', { name: 'OpenAI' });
    expect(spies.GET).not.toHaveBeenCalledWith(
      '/v1/outbound/integrations/{integration}/ai-tag-limits',
      expect.anything()
    );
    await user.click(within(openai).getByRole('button', { name: 'Per-tag limits' }));
    const form = await screen.findByRole('form', { name: 'Per-tag cost limits for OpenAI' });
    expect(await within(form).findByDisplayValue('feature=search')).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Add a tag' }));
    const tags = within(form).getAllByLabelText('Tag');
    const amounts = within(form).getAllByLabelText('Dollars a day');
    await user.type(tags[1], 'feature=chat');
    await user.type(amounts[1], '12.50');
    await user.click(within(form).getByRole('button', { name: 'Save tag limits' }));
    await waitFor(() =>
      expect(spies.PUT).toHaveBeenCalledWith(
        '/v1/outbound/integrations/{integration}/ai-tag-limits',
        {
          params: { path: { integration: 'a1' } },
          body: {
            limits: [
              { tag: 'feature=search', daily_cost_limit_millicents: 500_000 },
              { tag: 'feature=chat', daily_cost_limit_millicents: 1_250_000 },
            ],
          },
        }
      )
    );
  });

  it('shows apid’s refusal when saving tag limits fails', async () => {
    api({
      'PUT /v1/outbound/integrations/{integration}/ai-tag-limits': () =>
        problem(403, 'forbidden', 'deploy-write scope required'),
    });
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByText(/2 integrations/));
    const openai = screen.getByRole('region', { name: 'OpenAI' });
    await user.click(within(openai).getByRole('button', { name: 'Per-tag limits' }));
    const form = await screen.findByRole('form', { name: 'Per-tag cost limits for OpenAI' });
    await within(form).findByDisplayValue('feature=search');
    await user.click(within(form).getByRole('button', { name: 'Save tag limits' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(/deploy-write scope required/);
  });

  it('is hidden with no integrations, when off, and in a company workspace', async () => {
    const spies = api({ 'GET /v1/outbound/integrations': () => ({ items: [] }) });
    const { unmount } = show();
    await waitFor(() =>
      expect(spies.GET).toHaveBeenCalledWith('/v1/outbound/integrations', expect.anything())
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/integration/)).toBeNull();
    unmount();
    vi.restoreAllMocks();

    workspace.org = 'acme';
    const company = api();
    show();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/integration/)).toBeNull();
    expect(company.GET).not.toHaveBeenCalled();
  });

  async function openEditor(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByText(/2 integrations/));
    const openai = screen.getByRole('region', { name: 'OpenAI' });
    await user.click(within(openai).getByRole('button', { name: 'Per-tag limits' }));
    const form = await screen.findByRole('form', { name: 'Per-tag cost limits for OpenAI' });
    await within(form).findByDisplayValue('feature=search');
    return form;
  }

  it('asks for key=value tags, each once, with an amount above $0', async () => {
    const spies = api();
    const user = userEvent.setup();
    show();
    const form = await openEditor(user);
    const tag = within(form).getByLabelText('Tag');
    expect(tag).toHaveAttribute('placeholder', 'feature=search');
    await user.clear(tag);
    await user.type(tag, 'search');
    await user.click(within(form).getByRole('button', { name: 'Save tag limits' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Write each tag as key=value, such as feature=search.'
    );
    await user.clear(tag);
    await user.type(tag, 'feature=search');
    await user.click(within(form).getByRole('button', { name: 'Add a tag' }));
    await user.type(within(form).getAllByLabelText('Tag')[1], 'feature=search');
    await user.type(within(form).getAllByLabelText('Dollars a day')[1], '3');
    await user.click(within(form).getByRole('button', { name: 'Save tag limits' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Use each tag once.');
    await user.clear(within(form).getAllByLabelText('Dollars a day')[1]);
    await user.type(within(form).getAllByLabelText('Dollars a day')[1], '0');
    await user.clear(within(form).getAllByLabelText('Tag')[1]);
    await user.type(within(form).getAllByLabelText('Tag')[1], 'feature=chat');
    await user.click(within(form).getByRole('button', { name: 'Save tag limits' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(/above \$0/);
    expect(spies.PUT).not.toHaveBeenCalled();
  });

  it('removing every tag sends an empty list, and each Remove names its tag', async () => {
    const spies = api();
    const user = userEvent.setup();
    show();
    const form = await openEditor(user);
    await user.click(within(form).getByRole('button', { name: 'Remove feature=search' }));
    await user.click(within(form).getByRole('button', { name: 'Save tag limits' }));
    await waitFor(() =>
      expect(spies.PUT).toHaveBeenCalledWith(
        '/v1/outbound/integrations/{integration}/ai-tag-limits',
        { params: { path: { integration: 'a1' } }, body: { limits: [] } }
      )
    );
  });

  it('a list that couldn’t be read says so', async () => {
    api({ 'GET /v1/outbound/integrations': () => problem(422, 'validation_failed', 'nope') });
    show();
    expect(await screen.findByRole('heading', { name: 'Integrations and AI' })).toBeInTheDocument();
    expect(await screen.findByText(/nope|couldn.t|could not/i)).toBeInTheDocument();
  });

  it('a usage read that failed reads neutral, never fine', async () => {
    api({
      'GET /v1/outbound/integrations/{integration}/usage': () =>
        problem(422, 'validation_failed', 'nope'),
    });
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByText(/2 integrations/));
    const stripe = screen.getByRole('region', { name: 'Stripe' });
    await waitFor(() => expect(stripe).toHaveTextContent('Couldn’t read today’s use.'));
  });

  it('without the AI gateway, no AI reads and no tag editor', async () => {
    access.ai = 'off';
    const spies = api();
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByText(/2 integrations/));
    const openai = screen.getByRole('region', { name: 'OpenAI' });
    expect(within(openai).queryByRole('button', { name: 'Per-tag limits' })).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(spies.GET).not.toHaveBeenCalledWith(
      '/v1/outbound/integrations/{integration}/ai-usage',
      expect.anything()
    );
  });

  it('keeps a sub-cent tag limit as stored when other tags change', async () => {
    tagLimits = [{ tag: 'feature=embed', daily_cost_limit_millicents: 400 }];
    const spies = api();
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByText(/2 integrations/));
    const openai = screen.getByRole('region', { name: 'OpenAI' });
    await user.click(within(openai).getByRole('button', { name: 'Per-tag limits' }));
    const form = await screen.findByRole('form', { name: 'Per-tag cost limits for OpenAI' });
    expect(await within(form).findByDisplayValue('0.004')).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Add a tag' }));
    await user.type(within(form).getAllByLabelText('Tag')[1], 'feature=chat');
    await user.type(within(form).getAllByLabelText('Dollars a day')[1], '2');
    await user.click(within(form).getByRole('button', { name: 'Save tag limits' }));
    await waitFor(() =>
      expect(spies.PUT).toHaveBeenCalledWith(
        '/v1/outbound/integrations/{integration}/ai-tag-limits',
        {
          params: { path: { integration: 'a1' } },
          body: {
            limits: [
              { tag: 'feature=embed', daily_cost_limit_millicents: 400 },
              { tag: 'feature=chat', daily_cost_limit_millicents: 200_000 },
            ],
          },
        }
      )
    );
  });
});
