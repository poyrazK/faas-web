import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import * as sandboxAPI from '@/lib/api/api-sandboxes';
import { ApiError } from '@/lib/api/errors';
import { withRouter } from '@/test/router';
import { DebugSandboxScenarioAction } from './debug-sandbox-scenario';

vi.mock('@/lib/api/api-sandboxes', async (importOriginal) => ({
  ...(await importOriginal<typeof sandboxAPI>()),
  getDebugSandboxScenarioDraft: vi.fn(),
  saveSandboxLibraryScenario: vi.fn(),
}));

const draft = {
  deployment_id: 'e3fb6fea-01ea-42a2-8da2-229d51a82b6a',
  source_request_id: 'bdf6639e-d2ad-4865-b01f-43c14fe9c30b',
  expected_revision: '',
  method: 'GET' as const,
  route_template: '/exports/{id}',
};
const reviewed = {
  seed: { exports: [{ id: 'export_demo' }] },
  requests: [
    {
      title: 'Check download URL',
      method: 'GET' as const,
      path: '/exports/export_demo',
      expected_status: 200,
      assertions: [{ pointer: '/download_url', equals: 'https://example.test/export_demo' }],
    },
  ],
};

function renderAction() {
  const client = new QueryClient();
  render(
    withRouter(
      <QueryClientProvider client={client}>
        <DebugSandboxScenarioAction slug="exports" reqId="public-request" />
      </QueryClientProvider>
    )
  );
  return client;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(sandboxAPI.getDebugSandboxScenarioDraft).mockResolvedValue(draft);
});

it('saves reviewed synthetic inputs to the app library and opens the serving release with the scenario selected', async () => {
  const scenario = { ...reviewed, name: 'Request regression', revision: 'saved-revision' };
  vi.mocked(sandboxAPI.saveSandboxLibraryScenario).mockImplementation(async (_slug, id) => ({
    id,
    scenario,
    source_request_id: draft.source_request_id,
  }));
  renderAction();
  fireEvent.click(await screen.findByRole('button', { name: 'Create sandbox scenario' }));
  const editor = await screen.findByLabelText('Scenario JSON');
  expect(sandboxAPI.getDebugSandboxScenarioDraft).toHaveBeenCalledWith(
    'exports',
    'public-request',
    expect.any(AbortSignal)
  );
  expect(editor).toHaveValue(
    JSON.stringify(
      {
        seed: {},
        seeded_ids: {},
        requests: [
          {
            title: 'Check the expected response',
            method: 'GET',
            path: '/exports/{id}',
            expected_status: 0,
          },
        ],
      },
      null,
      2
    )
  );
  expect(sandboxAPI.saveSandboxLibraryScenario).not.toHaveBeenCalled();
  fireEvent.change(editor, { target: { value: JSON.stringify(reviewed) } });
  fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
  const link = await screen.findByRole<HTMLAnchorElement>('link', {
    name: 'Open release sandbox checks',
  });
  const target = new URL(link.href);
  const id = target.searchParams.get('sandboxScenario');
  expect(target.pathname).toBe(`/dashboard/apps/exports/releases/${draft.deployment_id}`);
  expect(target.searchParams.get('sandbox')).toBe('true');
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(sandboxAPI.saveSandboxLibraryScenario).toHaveBeenCalledWith('exports', id, {
    ...reviewed,
    name: 'Request regression',
    source_request_id: draft.source_request_id,
    expected_revision: '',
  });
});

it('preserves the draft when the app already has a scenario with the same name', async () => {
  vi.mocked(sandboxAPI.getDebugSandboxScenarioDraft).mockResolvedValue({
    ...draft,
    route_template: undefined,
    expected_revision: 'previous-revision',
  });
  vi.mocked(sandboxAPI.saveSandboxLibraryScenario).mockRejectedValue(
    new ApiError({ status: 409, code: 'conflict', title: 'Scenario name in use' })
  );
  renderAction();
  fireEvent.click(await screen.findByRole('button', { name: 'Create sandbox scenario' }));
  const editor = await screen.findByLabelText<HTMLTextAreaElement>('Scenario JSON');
  expect(JSON.parse(editor.value).requests[0].path).toBe('');
  const edited = JSON.stringify(reviewed);
  fireEvent.change(editor, { target: { value: edited } });
  fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Scenario name in use');
  expect(editor).toHaveValue(edited);
  expect(screen.queryByRole('link', { name: 'Open release sandbox checks' })).toBeNull();
  expect(sandboxAPI.saveSandboxLibraryScenario).toHaveBeenCalledWith(
    'exports',
    expect.any(String),
    expect.objectContaining({ expected_revision: '' })
  );
});

it('keeps the editor closed when request evidence has expired', async () => {
  vi.mocked(sandboxAPI.getDebugSandboxScenarioDraft).mockRejectedValue(
    new ApiError({ status: 404, code: 'not_found', title: 'Retained request telemetry not found' })
  );
  renderAction();
  fireEvent.click(await screen.findByRole('button', { name: 'Create sandbox scenario' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Retained request telemetry not found'
  );
  expect(screen.queryByLabelText('Scenario JSON')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close draft' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Create sandbox scenario' })).toBeInTheDocument()
  );
});
