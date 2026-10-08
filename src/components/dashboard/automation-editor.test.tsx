import { render, screen, waitFor } from '@testing-library/react';
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
}));
vi.mock('@/lib/use-unsaved-guard', () => ({ useUnsavedGuard: () => {} }));
vi.mock('@/lib/api/automations', () => ({
  useWriteAutomation: () => ({ mutateAsync: mocks.write, isPending: false }),
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
