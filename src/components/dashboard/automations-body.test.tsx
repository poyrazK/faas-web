import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationsBody, deleteConfirmation } from './automations-body';
import { ApiError } from '@/lib/api/errors';

const state = vi.hoisted(() => ({
  apps: [{ id: 'app-1', slug: 'alpha' }],
  read: vi.fn(),
  runtime: false,
  empty: false,
  toast: vi.fn(),
  maturity: 'preview' as string | undefined,
  confirm: vi.fn(),
  remove: vi.fn(),
  refetch: vi.fn(),
  source: 'dashboard',
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: () => ({
    capability: state.maturity
      ? { key: 'workflows-and-jobs', maturity: state.maturity }
      : undefined,
  }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'account-1' } }) }));
vi.mock('@/lib/api/queries', () => ({
  useApps: () => ({ data: state.apps, isPending: false, error: null, refetch: vi.fn() }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => state.confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock('./automation-editor', async () => {
  const { Modal } = await import('@/components/ui/modal');
  return {
    AutomationEditor: ({
      onClose,
      onSaved,
    }: {
      onClose?: () => void;
      onSaved: (next: { name: string }, outcome?: { published?: boolean; error?: string }) => void;
    }) =>
      onClose ? (
        <Modal open title="New automation" onClose={onClose}>
          <div>Draft editor</div>
          <button type="button" onClick={() => onSaved({ name: 'reports' }, { published: true })}>
            Finish publish
          </button>
          <button
            type="button"
            onClick={() => onSaved({ name: 'reports' }, { error: 'Draft revision 1 was saved.' })}
          >
            Finish partially
          </button>
        </Modal>
      ) : (
        <div>Draft editor</div>
      ),
    JsonReadout: () => null,
    JsonField: () => null,
  };
});
vi.mock('./automation-runs', () => ({ AutomationRuns: () => null }));
vi.mock('@/lib/api/automations', () => ({
  useAutomations: (...args: unknown[]) => {
    state.read(...args);
    const definition = {
      name: 'orders',
      steps: [{ name: 'process', path: '/process' }],
      trigger: { type: 'event', source: 'orders', event_type: '*' },
    };
    return {
      data: {
        runtime_enabled: state.runtime,
        unavailable_reason: state.runtime ? undefined : 'runtime_disabled',
        max_definitions: 10,
        automations: state.empty
          ? []
          : [
              {
                name: 'orders',
                draft: definition,
                published: definition,
                published_version: 2,
                version: 3,
                source: state.source,
                enabled: true,
              },
            ],
      },
      isPending: false,
      error: null,
      refetch: state.refetch,
    };
  },
  useAutomationHealth: () => ({
    data: {
      run_count: 4,
      completed_run_count: 0,
      success_rate: 0,
      active_run_count: 0,
      queued_run_count: 0,
      failed_steps: [],
    },
    isPending: false,
    error: null,
  }),
  useWriteAutomation: () => ({ isPending: false }),
  useDeleteAutomation: () => ({ mutateAsync: state.remove, isPending: false }),
  useStartAutomationRun: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
beforeEach(() => {
  state.apps = [{ id: 'app-1', slug: 'alpha' }];
  state.runtime = false;
  state.empty = false;
  state.read.mockClear();
  state.toast.mockClear();
  state.maturity = 'preview';
  state.confirm.mockReset().mockResolvedValue(true);
  state.remove.mockReset().mockResolvedValue(undefined);
  state.refetch.mockReset().mockResolvedValue({ error: null });
  state.source = 'dashboard';
});
it('keeps authoring discoverable while runtime execution is disabled', () => {
  render(<AutomationsBody search={{ app: 'alpha', automation: 'orders' }} onSelection={vi.fn()} />);
  expect(screen.getByText(/execution is not enabled/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'New automation' })).toBeEnabled();
  expect(screen.getByText('Draft editor')).toBeInTheDocument();
  expect(state.read).toHaveBeenCalledWith('account-1', 'alpha');
});
it('does not fetch a remembered fallback app for an inaccessible app link', () => {
  render(<AutomationsBody search={{ app: 'missing' }} onSelection={vi.fn()} />);
  expect(screen.getByText(/not in your accessible app list/)).toBeInTheDocument();
  expect(state.read).not.toHaveBeenCalled();
});
it('shows an empty app scope without starting disabled automation queries', () => {
  state.apps = [];
  render(<AutomationsBody search={{}} onSelection={vi.fn()} />);
  expect(screen.getByText(/workspace has none yet/)).toBeInTheDocument();
  expect(state.read).not.toHaveBeenCalled();
  expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
});
it('opens creation through URL selection and clears it when the dialog closes', async () => {
  const onSelection = vi.fn();
  const view = render(<AutomationsBody search={{ app: 'alpha' }} onSelection={onSelection} />);
  expect(screen.queryByText('Draft editor')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'New automation' }));
  expect(onSelection).toHaveBeenCalledWith({
    automation: undefined,
    automationView: undefined,
    automationRun: undefined,
    automationNew: true,
  });
  view.rerender(
    <AutomationsBody search={{ app: 'alpha', automationNew: true }} onSelection={onSelection} />
  );
  expect(screen.getByRole('dialog', { name: 'New automation' })).toHaveTextContent('Draft editor');
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onSelection).toHaveBeenLastCalledWith({ automationNew: undefined });
});

it('offers an app-scoped first-automation action without an empty search', async () => {
  state.empty = true;
  const onSelection = vi.fn();
  render(<AutomationsBody search={{ app: 'alpha' }} onSelection={onSelection} />);
  expect(screen.getByText(/Create your first automation for alpha/)).toBeInTheDocument();
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Create your first automation' }));
  expect(onSelection).toHaveBeenCalledWith({
    automation: undefined,
    automationView: undefined,
    automationRun: undefined,
    automationNew: true,
  });
});

it('opens the new automation and reports a create-and-publish outcome', async () => {
  const onSelection = vi.fn();
  render(
    <AutomationsBody search={{ app: 'alpha', automationNew: true }} onSelection={onSelection} />
  );
  await userEvent.click(screen.getByRole('button', { name: 'Finish publish' }));
  expect(state.toast).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: 'success', title: 'reports published' })
  );
  expect(onSelection).toHaveBeenLastCalledWith({
    automation: 'reports',
    automationView: undefined,
    automationRun: undefined,
    automationNew: undefined,
  });
  await userEvent.click(screen.getByRole('button', { name: 'Finish partially' }));
  expect(state.toast).toHaveBeenLastCalledWith({
    kind: 'error',
    title: 'reports: draft saved',
    description: 'Draft revision 1 was saved.',
  });
});

it('keeps the workspace to a summary and view tabs, with run input collapsed', async () => {
  state.runtime = true;
  const onSelection = vi.fn();
  render(
    <AutomationsBody search={{ app: 'alpha', automation: 'orders' }} onSelection={onSelection} />
  );
  expect(screen.getByText('4 runs in the last 7 days')).toBeInTheDocument();
  expect(screen.queryByText('Runs · last 7 days')).not.toBeInTheDocument();
  const tabs = screen.getByRole('tablist', { name: 'Automation views' });
  expect(within(tabs).getByRole('tab', { name: 'Definition' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  expect(screen.getByRole('tabpanel', { name: 'Definition' })).toHaveTextContent('Draft editor');
  await userEvent.click(within(tabs).getByRole('tab', { name: 'Run history' }));
  expect(onSelection).toHaveBeenLastCalledWith({ automationView: 'runs' });

  await userEvent.click(screen.getByRole('button', { name: 'Run now' }));
  const dialog = screen.getByRole('dialog', { name: 'Run orders' });
  const input = within(dialog)
    .getByText(/Run input · empty object/)
    .closest('details')!;
  expect(input).not.toHaveAttribute('open');
});

it('shows health tiles with the run history', () => {
  render(
    <AutomationsBody
      search={{ app: 'alpha', automation: 'orders', automationView: 'runs' }}
      onSelection={vi.fn()}
    />
  );
  expect(screen.getByText('Runs · last 7 days')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Run history' })).toHaveAttribute('aria-selected', 'true');
});

it.each([
  ['preview', '1 of 10 definitions used · Automations preview'],
  ['beta', '1 of 10 definitions used · Automations beta'],
  ['ga', '1 of 10 definitions used'],
  [undefined, '1 of 10 definitions used'],
])('labels the automation stage from the capability registry (%s)', (maturity, text) => {
  state.maturity = maturity;
  render(<AutomationsBody search={{ app: 'alpha' }} onSelection={vi.fn()} />);
  expect(screen.getByText(/definitions used/)).toHaveTextContent(new RegExp(`^${text}$`));
});

describe('deleting an automation', () => {
  const open = (onSelection = vi.fn()) => {
    render(
      <AutomationsBody search={{ app: 'alpha', automation: 'orders' }} onSelection={onSelection} />
    );
    return onSelection;
  };
  const conflict = (code: string) =>
    new ApiError({ status: 409, code, title: 'Conflict', detail: 'Server prose' });

  it('names the published automation, deletes at the observed revision, and returns to the list', async () => {
    const onSelection = open();
    await userEvent.click(screen.getByRole('button', { name: 'Delete automation' }));
    expect(state.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Delete orders?',
        description: expect.stringMatching(/published definition \(revision 2\) from alpha/),
        destructive: true,
        typeToConfirm: 'orders',
      })
    );
    expect(state.remove).toHaveBeenCalledWith({
      name: 'orders',
      expectedVersion: 3,
      restoreManifest: false,
    });
    expect(onSelection).toHaveBeenCalledWith({
      automation: undefined,
      automationView: undefined,
      automationRun: undefined,
      automationNew: undefined,
    });
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', title: 'orders deleted' })
    );
  });

  it('does nothing when the confirmation is cancelled', async () => {
    state.confirm.mockResolvedValue(false);
    const onSelection = open();
    await userEvent.click(screen.getByRole('button', { name: 'Delete automation' }));
    expect(state.remove).not.toHaveBeenCalled();
    expect(onSelection).not.toHaveBeenCalled();
  });

  it('keeps the automation open and explains a version conflict', async () => {
    state.remove.mockRejectedValue(conflict('automation_version_conflict'));
    const onSelection = open();
    await userEvent.click(screen.getByRole('button', { name: 'Delete automation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'orders was not deleted: it changed after you opened it. The latest revision is loaded'
    );
    expect(state.refetch).toHaveBeenCalled();
    expect(onSelection).not.toHaveBeenCalled();
  });

  it('asks again before returning a taken-over definition to the manifest', async () => {
    state.remove
      .mockRejectedValueOnce(conflict('automation_ownership_conflict'))
      .mockResolvedValueOnce(undefined);
    const onSelection = open();
    await userEvent.click(screen.getByRole('button', { name: 'Delete automation' }));
    expect(state.confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Return orders to the app manifest?' })
    );
    expect(state.remove).toHaveBeenLastCalledWith({
      name: 'orders',
      expectedVersion: 3,
      restoreManifest: true,
    });
    expect(onSelection).toHaveBeenCalledWith(expect.objectContaining({ automation: undefined }));
  });
});

it('says a never-published draft affects nothing, without asking for the name', () => {
  const options = deleteConfirmation(
    {
      name: 'nightly',
      version: 1,
      source: 'draft',
      enabled: false,
      draft: { name: 'nightly', steps: [] },
    } as never,
    'alpha'
  );
  expect(options).toMatchObject({ title: 'Delete nightly?', confirmLabel: 'Delete draft' });
  expect(options.description).toMatch(/draft \(revision 1\) from alpha. It was never published/);
  expect(options).not.toHaveProperty('typeToConfirm');
});

it('does not offer deletion of a manifest-owned definition', () => {
  state.source = 'manifest';
  render(<AutomationsBody search={{ app: 'alpha', automation: 'orders' }} onSelection={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Delete automation' })).toBeDisabled();
});
