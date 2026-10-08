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
          onSaved={(next) => {
            mocks.saved(next);
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
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(mocks.saved).toHaveBeenCalledOnce());
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith({
      kind: 'save',
      name: 'orders',
      body: expect.objectContaining({ expected_version: 0 }),
    });
    expect(screen.queryByRole('dialog', { name: 'New automation' })).not.toBeInTheDocument();
    expect(mocks.close).not.toHaveBeenCalled();
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
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
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
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    mocks.pending = true;
    view.rerender(<CreationDialog />);
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
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
    expect(mocks.saved).toHaveBeenCalledWith(automation);
    // A successful save may navigate before the mutation's pending flag clears.
    expect(await ask()).toBe(true);
  });
});

describe('automation editor write boundaries', () => {
  it('saves against the observed revision and keeps publish separate', async () => {
    mount();
    await userEvent.clear(screen.getByLabelText('Handler path'));
    await userEvent.type(screen.getByLabelText('Handler path'), '/changed');
    expect(screen.getByRole('button', { name: 'Publish draft' })).toBeDisabled();
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
    expect(screen.getByRole('button', { name: 'Publish draft' })).toBeDisabled();
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
