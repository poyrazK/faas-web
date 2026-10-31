import { useState } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationEditor } from './automation-editor';
import { ConfirmProvider } from '@/components/ui/confirm';
import { ApiError } from '@/lib/api/errors';
import type { Automation } from '@/lib/api/automations';

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  validate: vi.fn(),
  simulate: vi.fn(),
  saved: vi.fn(),
  reload: vi.fn(),
  close: vi.fn(),
  guard: vi.fn(),
  pending: false,
  routes: undefined as string[] | undefined,
}));
vi.mock('@/lib/api/queries', () => ({
  useAppRoutes: () => ({
    data: mocks.routes && { slug: 'app-1', routes: mocks.routes, source: 'live' },
  }),
}));
vi.mock('@/lib/use-unsaved-guard', () => ({ useUnsavedGuard: mocks.guard }));
vi.mock('@/lib/api/automations', () => ({
  useWriteAutomation: () => ({ mutateAsync: mocks.write, isPending: mocks.pending }),
  useValidateAutomation: () => ({ mutateAsync: mocks.validate, isPending: false }),
  useSimulateAutomation: () => ({ mutateAsync: mocks.simulate, isPending: false }),
}));
const automation: Automation = {
  name: 'orders',
  version: 12,
  published_version: 9,
  source: 'dashboard',
  enabled: true,
  draft: {
    name: 'orders',
    max_concurrent_runs: 0,
    max_concurrent_actions: 0,
    trigger: { type: 'manual' },
    steps: [{ name: 'process', path: '/process', method: 'POST' }],
  },
};
function mount(record = automation) {
  render(
    <ConfirmProvider>
      <AutomationEditor
        account="account-1"
        slug="app-1"
        automation={record}
        onSaved={mocks.saved}
        onReload={mocks.reload}
      />
    </ConfirmProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.pending = false;
  mocks.routes = undefined;
  mocks.write.mockResolvedValue({ ...automation, version: 13 });
  mocks.validate.mockResolvedValue({ valid: true, issues: [], step_order: ['process'] });
  mocks.simulate.mockResolvedValue({
    definition_valid: true,
    complete: false,
    issues: [],
    warnings: [],
    step_order: ['process'],
    trace: [{ step_name: 'process', kind: 'path', state: 'would_execute' }],
  });
});

function CreationDialog() {
  const [open, setOpen] = useState(true);
  return (
    <ConfirmProvider>
      {open && (
        <AutomationEditor
          account="account-1"
          slug="app-1"
          onSaved={(...args) => {
            mocks.saved(...args);
            setOpen(false);
          }}
          onClose={() => {
            mocks.close();
            setOpen(false);
          }}
          onReload={mocks.reload}
        />
      )}
    </ConfirmProvider>
  );
}

describe('new automation dialog', () => {
  it('starts with basic fields and preserves advanced edits when collapsed', async () => {
    render(<CreationDialog />);
    const advanced = screen.getByText('Advanced step settings').closest('details')!;
    expect(advanced).not.toHaveAttribute('open');
    expect(screen.getByText('Simulate with sample data').closest('details')).not.toHaveAttribute(
      'open'
    );
    await userEvent.click(screen.getByText('Advanced step settings'));
    await userEvent.type(screen.getByLabelText('Timeout'), '45s');
    await userEvent.click(screen.getByText('Advanced step settings'));
    await userEvent.type(screen.getByLabelText('Automation name'), 'orders');
    await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    await waitFor(() =>
      expect(mocks.write).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            definition: expect.objectContaining({
              steps: [expect.objectContaining({ timeout: '45s' })],
            }),
          }),
        })
      )
    );
  });

  it('creates a scheduled draft from a template without publishing it', async () => {
    render(<CreationDialog />);
    await userEvent.click(screen.getByRole('button', { name: /Run on a schedule/ }));
    expect(screen.getByLabelText('Schedule')).toHaveValue('0 * * * *');
    expect(screen.getByLabelText('HTTP method')).toHaveValue('GET');
    expect(mocks.write).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Automation name'), 'hourly-report');
    await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    await waitFor(() =>
      expect(mocks.write).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'save',
          body: expect.objectContaining({
            definition: expect.objectContaining({
              trigger: expect.objectContaining({
                type: 'schedule',
                schedule: '0 * * * *',
                timezone: 'UTC',
                overlap: 'skip',
              }),
            }),
          }),
        })
      )
    );
    expect(mocks.write).toHaveBeenCalledOnce();
  });

  it('previews the schedule live and keeps presets for any timezone', async () => {
    render(<CreationDialog />);
    await userEvent.click(screen.getByRole('button', { name: /Run on a schedule/ }));
    expect(screen.getByLabelText('Upcoming scheduled runs')).toHaveTextContent('Every hour');
    await userEvent.selectOptions(screen.getByLabelText('Schedule preset'), '0 9 * * *');
    expect(screen.getByLabelText('Upcoming scheduled runs')).toHaveTextContent(
      'Daily at 09:00 UTC'
    );
    const zone = screen.getByLabelText('Timezone');
    await userEvent.clear(zone);
    await userEvent.type(zone, 'Europe/Istanbul');
    expect(screen.getByLabelText('Schedule preset')).toHaveValue('0 9 * * *');
    expect(
      screen.getByRole('option', { name: 'Daily at 09:00 Europe/Istanbul' })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Upcoming scheduled runs')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Schedule summary')).toHaveTextContent(
      /Daily at 09:00 Europe\/Istanbul.*Validate to get the next start in Europe\/Istanbul/
    );
    expect(mocks.validate).not.toHaveBeenCalled();
  });

  it('keeps customized steps when replacement is cancelled and preserves the name on acceptance', async () => {
    render(<CreationDialog />);
    await userEvent.type(screen.getByLabelText('Automation name'), 'orders');
    await userEvent.type(screen.getByLabelText('Handler path'), 'custom');
    await userEvent.click(screen.getByRole('button', { name: /Connect two steps/ }));
    let confirmation = within(screen.getByRole('dialog', { name: 'Replace the current steps?' }));
    await userEvent.click(confirmation.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Handler path')).toHaveValue('/custom');
    await userEvent.click(screen.getByRole('button', { name: /Connect two steps/ }));
    confirmation = within(screen.getByRole('dialog', { name: 'Replace the current steps?' }));
    await userEvent.click(confirmation.getByRole('button', { name: 'Use template' }));
    expect(screen.getByLabelText('Automation name')).toHaveValue('orders');
    expect(screen.getAllByLabelText('Handler path')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    await waitFor(() =>
      expect(mocks.write).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            definition: expect.objectContaining({
              steps: [
                expect.objectContaining({ name: 'step-1' }),
                expect.objectContaining({ name: 'step-2', depends_on: ['step-1'] }),
              ],
            }),
          }),
        })
      )
    );
  });
  it('focuses the name and cancels an untouched draft without writing', async () => {
    render(<CreationDialog />);
    expect(screen.getByRole('dialog', { name: 'New automation' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Automation name')).toHaveFocus());
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New automation' })).not.toBeInTheDocument()
    );
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('preserves edits when discard is cancelled and asks only once on accepted close', async () => {
    render(<CreationDialog />);
    await userEvent.type(screen.getByLabelText('Automation name'), 'orders');
    await userEvent.keyboard('{Escape}');
    const confirmation = screen.getByRole('dialog', { name: 'Discard automation edits?' });
    await userEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(confirmation).not.toBeInTheDocument());
    expect(screen.getByLabelText('Automation name')).toHaveValue('orders');
    expect(mocks.close).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
    // Closing changes URL search state; the router guard must accept that
    // navigation without asking for the same discard a second time.
    const ask = mocks.guard.mock.lastCall![1] as () => Promise<boolean>;
    expect(await ask()).toBe(true);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('creates revision zero as a draft and closes after saving without publishing', async () => {
    render(<CreationDialog />);
    await userEvent.type(screen.getByLabelText('Automation name'), 'orders');
    await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    await waitFor(() => expect(mocks.saved).toHaveBeenCalledOnce());
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith({
      kind: 'save',
      name: 'orders',
      body: expect.objectContaining({ expected_version: 0 }),
    });
    expect(screen.queryByRole('dialog', { name: 'New automation' })).not.toBeInTheDocument();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it('creates and publishes in one action after an honest confirmation', async () => {
    const saved = { ...automation, version: 1, published_version: undefined, published: undefined };
    const published = { ...automation, version: 2, published_version: 2 };
    mocks.write.mockResolvedValueOnce(saved).mockResolvedValueOnce(published);
    render(<CreationDialog />);
    await userEvent.click(screen.getByRole('button', { name: /Run on a schedule/ }));
    await userEvent.type(screen.getByLabelText('Automation name'), 'orders');
    await userEvent.click(screen.getByRole('button', { name: 'Create and publish' }));
    const confirmation = screen.getByRole('dialog', { name: 'Create and publish orders?' });
    expect(confirmation).toHaveTextContent(
      /saves orders as a new draft, then publishes that draft/
    );
    expect(confirmation).toHaveTextContent(/Scheduled starts use it while automatic starts/);
    expect(mocks.write).not.toHaveBeenCalled();
    await userEvent.click(within(confirmation).getByRole('button', { name: 'Create and publish' }));
    await waitFor(() => expect(mocks.saved).toHaveBeenCalledOnce());
    expect(mocks.write).toHaveBeenNthCalledWith(1, {
      kind: 'save',
      name: 'orders',
      body: expect.objectContaining({
        expected_version: 0,
        definition: expect.objectContaining({ name: 'orders' }),
      }),
    });
    expect(mocks.write).toHaveBeenNthCalledWith(2, {
      kind: 'publish',
      name: 'orders',
      body: { expected_version: 1, take_over_manifest: false },
    });
    expect(mocks.saved).toHaveBeenCalledWith(published, { published: true });
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it('writes nothing when create-and-publish is not confirmed', async () => {
    render(<CreationDialog />);
    await userEvent.type(screen.getByLabelText('Automation name'), 'orders');
    await userEvent.click(screen.getByRole('button', { name: 'Create and publish' }));
    const confirmation = screen.getByRole('dialog', { name: 'Create and publish orders?' });
    await userEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    expect(mocks.write).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'New automation' })).toBeInTheDocument();
  });

  it('hands a saved draft to its workspace when publishing it fails', async () => {
    const saved = { ...automation, version: 1, published_version: undefined, published: undefined };
    mocks.write
      .mockResolvedValueOnce(saved)
      .mockRejectedValueOnce(
        new ApiError({ status: 422, code: 'automation_invalid', title: 'Definition is invalid.' })
      );
    render(<CreationDialog />);
    await userEvent.type(screen.getByLabelText('Automation name'), 'orders');
    await userEvent.click(screen.getByRole('button', { name: 'Create and publish' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Create and publish orders?' })).getByRole(
        'button',
        { name: 'Create and publish' }
      )
    );
    await waitFor(() =>
      expect(mocks.saved).toHaveBeenCalledWith(saved, {
        error: 'Draft revision 1 was saved but not published. Definition is invalid.',
      })
    );
    expect(mocks.write).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed draft open for correction', async () => {
    mocks.write.mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'automation_invalid_definition',
        title: 'Invalid definition',
      })
    );
    render(<CreationDialog />);
    await userEvent.type(screen.getByLabelText('Automation name'), 'orders');
    await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid definition'));
    expect(screen.getByLabelText('Automation name')).toHaveValue('orders');
    expect(screen.getByRole('dialog', { name: 'New automation' })).toBeInTheDocument();
    expect(mocks.saved).not.toHaveBeenCalled();
  });

  it('prevents dismissal and further creation while a write is pending', async () => {
    const view = render(<CreationDialog />);
    await userEvent.type(screen.getByLabelText('Automation name'), 'orders');
    let finish!: (record: Automation) => void;
    mocks.write.mockReturnValue(new Promise<Automation>((resolve) => (finish = resolve)));
    await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    mocks.pending = true;
    view.rerender(<CreationDialog />);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByLabelText('Automation name')).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(
      screen.queryByRole('dialog', { name: 'Discard automation edits?' })
    ).not.toBeInTheDocument();
    expect(mocks.close).not.toHaveBeenCalled();
    const ask = mocks.guard.mock.lastCall![1] as () => Promise<boolean>;
    expect(await ask()).toBe(false);
    expect(mocks.write).toHaveBeenCalledOnce();
    await act(async () => finish(automation));
    expect(mocks.saved).toHaveBeenCalledWith(automation, undefined);
    // A successful save may navigate before the mutation's pending flag clears.
    expect(await ask()).toBe(true);
  });
});

describe('automation editor write boundaries', () => {
  it('opens on the essentials with secondary tools collapsed', () => {
    mount({
      ...automation,
      draft: {
        ...automation.draft,
        trigger: { type: 'schedule', schedule: '0 * * * *', timezone: 'UTC', overlap: 'skip' },
      },
    });
    for (const summary of [
      'Advanced trigger settings',
      'Advanced step settings',
      'Simulate with sample data',
    ])
      expect(screen.getByText(summary).closest('details')).not.toHaveAttribute('open');
    expect(screen.getByLabelText('Schedule preset')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Publish draft' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Advanced JSON' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Full definition (JSON)')).not.toBeInTheDocument();
  });
  it('saves a draft against the observed revision without publishing it', async () => {
    mount();
    await userEvent.clear(screen.getByLabelText('Handler path'));
    await userEvent.type(screen.getByLabelText('Handler path'), '/changed');
    expect(screen.getByRole('button', { name: 'Save and publish' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(mocks.write).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'save',
          name: 'orders',
          body: expect.objectContaining({
            expected_version: 12,
            definition: expect.objectContaining({
              steps: [expect.objectContaining({ path: '/changed' })],
            }),
          }),
        })
      )
    );
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Draft saved/)).toBeInTheDocument();
  });
  it('saves unsaved edits and publishes the saved revision in one action', async () => {
    let finishSave!: (record: Automation) => void;
    const saved = {
      ...automation,
      version: 13,
      draft: {
        ...automation.draft,
        steps: [{ name: 'process', path: '/changed', method: 'POST' as const }],
      },
    };
    mocks.write
      .mockReturnValueOnce(new Promise<Automation>((resolve) => (finishSave = resolve)))
      .mockResolvedValueOnce({ ...saved, version: 14, published_version: 14 });
    mount();
    await userEvent.clear(screen.getByLabelText('Handler path'));
    await userEvent.type(screen.getByLabelText('Handler path'), '/changed');
    await userEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    const confirmation = screen.getByRole('dialog', { name: 'Save and publish orders?' });
    expect(confirmation).toHaveTextContent(
      /unsaved edits are saved as a new draft over revision 12, then published/
    );
    await userEvent.click(within(confirmation).getByRole('button', { name: 'Save and publish' }));
    expect(await screen.findByText('Step 1 of 2: saving the draft…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saving draft…' })).toBeDisabled();
    await act(async () => finishSave(saved));
    await waitFor(() => expect(screen.getByText(/Saved and published/)).toBeInTheDocument());
    expect(mocks.write).toHaveBeenNthCalledWith(1, {
      kind: 'save',
      name: 'orders',
      body: expect.objectContaining({
        expected_version: 12,
        definition: expect.objectContaining({
          steps: [expect.objectContaining({ path: '/changed' })],
        }),
      }),
    });
    expect(mocks.write).toHaveBeenNthCalledWith(2, {
      kind: 'publish',
      name: 'orders',
      body: { expected_version: 13, take_over_manifest: false },
    });
    expect(screen.getByRole('button', { name: 'Publish draft' })).toBeEnabled();
  });
  it('keeps the saved draft and blocks writes when the publish outcome is unknown', async () => {
    const saved = {
      ...automation,
      version: 13,
      draft: {
        ...automation.draft,
        steps: [{ name: 'process', path: '/changed', method: 'POST' as const }],
      },
    };
    mocks.write
      .mockResolvedValueOnce(saved)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    mount();
    await userEvent.clear(screen.getByLabelText('Handler path'));
    await userEvent.type(screen.getByLabelText('Handler path'), '/changed');
    await userEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Save and publish orders?' })).getByRole('button', {
        name: 'Save and publish',
      })
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Draft revision 13 was saved. The publish outcome is unknown. Reload the saved definition'
      )
    );
    expect(screen.getByLabelText('Handler path')).toHaveValue('/changed');
    expect(screen.getByRole('button', { name: 'Publish draft' })).toBeDisabled();
    expect(mocks.write).toHaveBeenCalledTimes(2);
  });
  it('saves edits before a manifest takeover only after typed confirmation', async () => {
    mocks.write
      .mockResolvedValueOnce({ ...automation, source: 'manifest', version: 13 })
      .mockResolvedValueOnce({ ...automation, version: 14, published_version: 14 });
    mount({ ...automation, source: 'manifest' });
    await userEvent.type(screen.getByLabelText('Handler path'), '-v2');
    await userEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/takes ownership from the app manifest/);
    expect(screen.getByRole('button', { name: 'Take over and publish' })).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: /Type/ }), 'orders');
    await userEvent.click(screen.getByRole('button', { name: 'Take over and publish' }));
    await waitFor(() =>
      expect(mocks.write).toHaveBeenNthCalledWith(2, {
        kind: 'publish',
        name: 'orders',
        body: { expected_version: 13, take_over_manifest: true },
      })
    );
  });
  it('requires explicit manifest takeover before publication', async () => {
    mount({ ...automation, source: 'manifest' });
    await userEvent.click(screen.getByRole('button', { name: 'Publish draft' }));
    expect(mocks.write).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent(/takes ownership from the app manifest/);
    await userEvent.type(screen.getByRole('textbox', { name: /Type/ }), 'orders');
    await userEvent.click(screen.getByRole('button', { name: 'Take over and publish' }));
    await waitFor(() =>
      expect(mocks.write).toHaveBeenCalledWith({
        kind: 'publish',
        name: 'orders',
        body: { expected_version: 12, take_over_manifest: true },
      })
    );
  });
  it('keeps local edits and blocks further writes after a version conflict', async () => {
    mocks.write.mockRejectedValue(
      new ApiError({ status: 409, code: 'automation_version_conflict', title: 'Conflict' })
    );
    mount();
    await userEvent.type(screen.getByLabelText('Handler path'), '-changed');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Another editor/));
    expect(screen.getByLabelText('Handler path')).toHaveValue('/process-changed');
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save and publish' })).toBeDisabled();
  });
  it('validates and simulates without saving, publishing, or starting a run', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Validate definition' }));
    await waitFor(() => expect(screen.getByText('Definition is valid')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Simulate definition' }));
    await waitFor(() => expect(screen.getByText(/Partial simulation/)).toBeInTheDocument());
    expect(mocks.simulate).toHaveBeenCalledWith(
      expect.objectContaining({ input: {}, mock_outputs: {} })
    );
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('suggests observed app routes for handler paths while keeping free text', async () => {
    mocks.routes = ['POST /orders', 'GET /orders', 'GET /health', '__route_other__'];
    mount();
    const path = screen.getByLabelText('Handler path');
    const list = document.getElementById(path.getAttribute('list')!)!;
    expect(list.tagName).toBe('DATALIST');
    expect([...list.querySelectorAll('option')].map((option) => option.value)).toEqual([
      '/health',
      '/orders',
    ]);
    expect(path).toHaveAccessibleDescription('Choose an observed route or type any path.');
    await userEvent.clear(path);
    await userEvent.type(path, '/orders');
    expect(path).toHaveAccessibleDescription('Observed as GET, POST.');
    await userEvent.type(path, '/custom');
    expect(path).toHaveValue('/orders/custom');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(mocks.write).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            definition: expect.objectContaining({
              steps: [expect.objectContaining({ path: '/orders/custom' })],
            }),
          }),
        })
      )
    );
  });
  it('offers no route list when the app reports none', () => {
    mount();
    expect(screen.getByLabelText('Handler path')).not.toHaveAttribute('list');
  });
  it('picks dependencies from other steps and keeps names that match no step', async () => {
    mount({
      ...automation,
      draft: {
        ...automation.draft,
        steps: [
          { name: 'process', path: '/process', method: 'POST' },
          { name: 'notify', path: '/notify', method: 'POST', depends_on: ['process', 'legacy'] },
        ],
      },
    });
    const picker = within(screen.getByRole('group', { name: 'Runs after (step 2)' }));
    expect(picker.getByRole('checkbox', { name: 'process' })).toBeChecked();
    expect(picker.getByRole('checkbox', { name: /legacy/ })).toBeChecked();
    expect(picker.getByText('not a step in this definition')).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Runs after (step 1)' })).getByRole('checkbox', {
        name: 'notify',
      })
    ).not.toBeChecked();
    await userEvent.type(screen.getAllByLabelText('Step name')[0], '-order');
    expect(picker.getByRole('checkbox', { name: 'process-order' })).toBeChecked();
    await userEvent.click(picker.getByRole('checkbox', { name: 'process-order' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(mocks.write).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            definition: expect.objectContaining({
              steps: [
                expect.objectContaining({ name: 'process-order', depends_on: [] }),
                expect.objectContaining({ name: 'notify', depends_on: ['legacy'] }),
              ],
            }),
          }),
        })
      )
    );
  });
  it('rejects invalid JSON locally and preserves the text for correction', async () => {
    mount();
    await userEvent.clear(screen.getByLabelText('Input mapping (JSON)'));
    await userEvent.type(screen.getByLabelText('Input mapping (JSON)'), 'invalid');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/valid JSON/);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Input mapping (JSON)')).toHaveValue('invalid');
  });
});
