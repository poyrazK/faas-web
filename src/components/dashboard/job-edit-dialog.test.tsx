import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const update = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();
vi.mock('@/lib/api/jobs', () => ({
  useUpdateJobDefinition: () => ({ mutateAsync: update, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { JobEditDialog } = await import('./job-edit-dialog');

const job = {
  id: 'job-1',
  account_id: 'acct',
  name: 'nightly-export',
  kind: 'batch' as const,
  image_ref: 'ghcr.io/acme/export:v1',
  image_materialization_status: 'ready' as const,
  command: ['python', '-m', 'export'],
  env_overrides: { LOG_LEVEL: 'info' },
  ram_mb: 512,
  task_timeout_sec: 600,
  max_parallelism: 5,
  retry_max: 2,
  status: 'active' as const,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

function setup(over: Record<string, unknown> = {}) {
  const onClose = vi.fn();
  render(<JobEditDialog job={{ ...job, ...over }} onClose={onClose} />);
  return { onClose, user: userEvent.setup(), dialog: screen.getByRole('dialog') };
}
const save = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Save changes' }));

beforeEach(() => {
  update.mockReset().mockImplementation(async ({ name }: { name: string }) => ({ ...job, name }));
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});

describe('JobEditDialog', () => {
  it('starts from the stored definition', () => {
    const { dialog } = setup();
    expect(within(dialog).getByLabelText('Container image')).toHaveValue('ghcr.io/acme/export:v1');
    expect(within(dialog).getByLabelText('Executable')).toHaveValue('python');
    expect(within(dialog).getByLabelText('Arguments')).toHaveValue('-m\nexport');
    expect(within(dialog).getByLabelText('Environment overrides')).toHaveValue('LOG_LEVEL=info');
    expect(within(dialog).getByLabelText('Retries per task')).toHaveValue(2);
  });

  it('sends only what changed, after a confirm that says what happens', async () => {
    const { user, onClose, dialog } = setup();
    const image = within(dialog).getByLabelText('Container image');
    await user.clear(image);
    await user.type(image, 'ghcr.io/acme/export:v2');
    expect(screen.getByText(/pulled and prepared again/)).toBeInTheDocument();
    const retries = within(dialog).getByLabelText('Retries per task');
    await user.clear(retries);
    await user.type(retries, '0');
    await save(user);
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    const asked = confirm.mock.calls[0]![0] as { title: string; description: string };
    expect(asked.title).toBe('Save changes to nightly-export?');
    expect(asked.description).toMatch(/image, retries/);
    expect(asked.description).toMatch(/pulled and prepared before any task starts/);
    expect(asked.description).toMatch(/runs already recorded keep/);
    expect(update).toHaveBeenCalledWith({
      name: 'nightly-export',
      image_ref: 'ghcr.io/acme/export:v2',
      retry_max: 0,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('replaces the environment and the command as a whole', async () => {
    const { user, dialog } = setup();
    const env = within(dialog).getByLabelText('Environment overrides');
    await user.clear(env);
    await user.type(env, 'REGION=eu{enter}LOG_LEVEL=debug');
    const args = within(dialog).getByLabelText('Arguments');
    await user.clear(args);
    await user.type(args, '--full');
    await save(user);
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        name: 'nightly-export',
        command: ['python', '--full'],
        env_overrides: { REGION: 'eu', LOG_LEVEL: 'debug' },
      })
    );
  });

  it('adds failure rules, and says what they change', async () => {
    const { user, dialog } = setup();
    await user.click(within(dialog).getByLabelText(/Classify failures with explicit rules/));
    await user.click(within(dialog).getByRole('button', { name: 'Add rule' }));
    await user.type(within(dialog).getByLabelText('Rule 1 codes'), '65');
    await user.selectOptions(within(dialog).getByLabelText('Completion receipt lost'), 'retry');
    expect(within(dialog).getByText(/can repeat work that already committed/)).toBeInTheDocument();
    await save(user);
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]![0]).toEqual({
      name: 'nightly-export',
      failure_rules: {
        version: 1,
        rules: [{ exit_codes: [65], action: 'fail_partition' }],
        unmatched_failure: 'retry',
        uncertain_outcome: 'retry',
      },
    });
    expect((confirm.mock.calls[0]![0] as { description: string }).description).toMatch(
      /retried or stopped by the new rules/
    );
  });

  it('keeps stored rules on: they can be replaced but not removed', () => {
    setup({
      failure_rules: {
        version: 1,
        rules: [{ outcome_codes: ['invalid_record'], action: 'fail_partition' }],
        unmatched_failure: 'retry',
        uncertain_outcome: 'hold',
      },
    });
    expect(screen.getByLabelText(/Classify failures with explicit rules/)).toBeDisabled();
    expect(screen.getByLabelText('Rule 1 codes')).toHaveValue('invalid_record');
    expect(screen.getByText(/can be changed but not removed/)).toBeInTheDocument();
  });

  it.each([
    ['Memory (MB)', '32', /at least 64 MB/],
    ['Parallel tasks', '0', /at least 1/],
  ])('refuses %s of %s before any confirm', async (label, value, message) => {
    const { user, dialog } = setup();
    const field = within(dialog).getByLabelText(label);
    await user.clear(field);
    await user.type(field, value);
    await save(user);
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('refuses a malformed environment line', async () => {
    const { user, dialog } = setup();
    const env = within(dialog).getByLabelText('Environment overrides');
    await user.clear(env);
    await user.type(env, 'lower=1');
    await save(user);
    expect(await within(dialog).findByText(/Line 1: write KEY=VALUE/)).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it('says when nothing changed, and sends nothing', async () => {
    const { user } = setup();
    await save(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing has changed.');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('sends nothing when the confirm is declined', async () => {
    confirm.mockResolvedValue(false);
    const { user, dialog } = setup();
    const retries = within(dialog).getByLabelText('Retries per task');
    await user.clear(retries);
    await user.type(retries, '3');
    await save(user);
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(update).not.toHaveBeenCalled();
  });

  it('explains the active-runs refusal', async () => {
    update.mockRejectedValue(
      new ApiError({ status: 409, code: 'validation_failed', title: 'Job has active runs' })
    );
    const { user, dialog } = setup();
    const retries = within(dialog).getByLabelText('Retries per task');
    await user.clear(retries);
    await user.type(retries, '3');
    await save(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /tasks queued or running. Wait for them to finish/
    );
  });

  it('names the plan ceiling for the field that crossed it', async () => {
    update.mockRejectedValue(
      new ApiError({
        status: 403,
        code: 'job_quota_exceeded',
        title: 'Job limit reached',
        limit: 2048,
        observed: 4096,
      })
    );
    const { user, dialog } = setup();
    const ram = within(dialog).getByLabelText('Memory (MB)');
    await user.clear(ram);
    await user.type(ram, '4096');
    await save(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your plan allows up to 2,048 MB here.'
    );
  });
});
