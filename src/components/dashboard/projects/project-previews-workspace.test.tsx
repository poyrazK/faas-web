import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectPreviews } from './preview-workload-set';
import { spyApi } from '@/test/api';

const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
beforeEach(() => {
  workspace.org = null;
  workspace.label = 'Personal';
});
afterEach(() => vi.restoreAllMocks());
const ok = (data: unknown) => ({ data, response: new Response() }) as never;
function mount(selected?: string) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProjectPreviews
        accountId="a"
        projectSlug="shop"
        parents={['api']}
        selected={selected}
        onSelect={vi.fn()}
      />
    </QueryClientProvider>
  );
}

it("reads no preview apps for a company's project, and says why", async () => {
  // Preview discovery reads GET /v1/apps, the signed-in account's own apps:
  // in a company workspace it would list personal previews. The workspace
  // inventory (OrgAppSummary) carries no preview fields, and
  // GET /v1/preview/{slug}/environment is not among the routes company
  // members reach (faas pkg/apid/appaccess/routes.go).
  workspace.org = 'acme';
  workspace.label = 'Acme';
  const get = spyApi('GET').mockResolvedValue(ok([]));
  mount('preview-api');
  expect(
    await screen.findByText(/PR previews for Acme's projects are not listed in the console yet/)
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Browse previews' })).not.toBeInTheDocument();
  expect(get).not.toHaveBeenCalled();
});

it('still discovers previews in the personal workspace', async () => {
  const get = spyApi('GET').mockResolvedValue(ok([]));
  mount();
  await userEvent.click(screen.getByRole('button', { name: 'Browse previews' }));
  expect(await screen.findByText('No project preview apps reported.')).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith('/v1/apps', expect.anything());
});
