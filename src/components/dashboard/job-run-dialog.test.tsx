import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const startRun = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();
vi.mock('@/lib/api/queries', () => ({
  useStartJobRun: () => ({ mutateAsync: startRun, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { JobRunDialog } = await import('./job-run-dialog');

const job = {
  command: ['python', '-m', 'etl.run'],
  max_parallelism: 10,
  retry_max: 3,
  task_timeout_sec: 900,
};

function setup() {
  const onStarted = vi.fn();
  render(
    <JobRunDialog
      name="nightly"
      job={job}
      attempts={{ current: new Map() }}
      onClose={vi.fn()}
      onStarted={onStarted}
    />
  );
  const user = userEvent.setup();
  const dialog = screen.getByRole('dialog');
  const options = () => user.click(within(dialog).getByText('Run options'));
  const submit = () => user.click(within(dialog).getByRole('button', { name: 'Continue' }));
  return { user, dialog, options, submit, onStarted };
}
const sent = () => startRun.mock.calls[0]![0] as Record<string, unknown>;
const asked = () => confirm.mock.calls[0]![0] as { title: string; description: string };

beforeEach(() => {
  startRun.mockReset().mockResolvedValue({ id: 'run-1', tasks: 2, aggregate_status: 'queued' });
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});

describe('JobRunDialog run options', () => {
  it('fans out one task per input line, in order', async () => {
    const { user, dialog, submit, onStarted } = setup();
    await user.click(within(dialog).getByRole('button', { name: 'Input list' }));
    await user.type(
      within(dialog).getByLabelText('Inputs'),
      'shard-a=s3://b/a{enter}shard-b=s3://b/b'
    );
    await submit();
    await waitFor(() => expect(startRun).toHaveBeenCalled());
    expect(asked().title).toBe('Start 2 tasks of nightly?');
    expect(sent()).toEqual({
      name: 'nightly',
      idempotencyKey: expect.any(String),
      inputs: [
        { input_id: 'shard-a', input_ref: 's3://b/a' },
        { input_id: 'shard-b', input_ref: 's3://b/b' },
      ],
    });
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('run-1'));
  });

  it('refuses a duplicate input before any confirm', async () => {
    const { user, dialog, submit } = setup();
    await user.click(within(dialog).getByRole('button', { name: 'Input list' }));
    await user.type(within(dialog).getByLabelText('Inputs'), 'a=1{enter}a=2');
    await submit();
    expect(await within(dialog).findByText(/appears twice/)).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('reads an input manifest by object and digest', async () => {
    const { user, dialog, submit } = setup();
    await user.click(within(dialog).getByRole('button', { name: 'Input manifest' }));
    await user.type(within(dialog).getByLabelText('Manifest object'), 'obj://app/bkt/in.json');
    await user.type(within(dialog).getByLabelText('Manifest SHA-256'), `sha256:${'a'.repeat(64)}`);
    await submit();
    await waitFor(() => expect(startRun).toHaveBeenCalled());
    expect(asked().title).toBe('Start a run of nightly from an input manifest?');
    expect(asked().description).toMatch(/checks its bytes against the digest/);
    expect(sent()).toMatchObject({
      input_manifest_uri: 'obj://app/bkt/in.json',
      input_manifest_sha256: `sha256:${'a'.repeat(64)}`,
    });
    expect(sent()).not.toHaveProperty('tasks');
  });

  it('refuses a manifest that is not an obj:// object with a sha256 digest', async () => {
    const { user, dialog, submit } = setup();
    await user.click(within(dialog).getByRole('button', { name: 'Input manifest' }));
    await user.type(within(dialog).getByLabelText('Manifest object'), 's3://b/in.json');
    await user.type(within(dialog).getByLabelText('Manifest SHA-256'), 'abc');
    await submit();
    expect(await within(dialog).findByText(/obj:\/\/APP_ID\/BUCKET_ID\/KEY/)).toBeInTheDocument();
    expect(within(dialog).getByText(/64 lowercase hex digits/)).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('sends a flexible window, fail-fast, arguments and overrides, and says so in the confirm', async () => {
    const { user, dialog, options, submit } = setup();
    await options();
    await user.click(within(dialog).getByLabelText(/Flexible start window/));
    const latest = new Date(Date.now() + 3 * 3_600_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const local = `${latest.getFullYear()}-${pad(latest.getMonth() + 1)}-${pad(latest.getDate())}T${pad(latest.getHours())}:${pad(latest.getMinutes())}`;
    await user.type(within(dialog).getByLabelText('Latest start'), local);
    await user.click(within(dialog).getByLabelText(/Fail fast/));
    await user.click(within(dialog).getByLabelText(/Replace the arguments/));
    await user.type(within(dialog).getByLabelText('Arguments'), '--dataset{enter}2026-09');
    await user.type(within(dialog).getByLabelText('Retries per task'), '0');
    await user.type(within(dialog).getByLabelText('Environment for this run'), 'DATASET=2026-09');
    await submit();
    await waitFor(() => expect(startRun).toHaveBeenCalled());
    expect(sent()).toEqual({
      name: 'nightly',
      idempotencyKey: expect.any(String),
      tasks: 1,
      execution_class: 'flexible',
      latest_start_at: new Date(Date.parse(local)).toISOString(),
      failure_policy: 'fail_fast',
      arguments: ['--dataset', '2026-09'],
      retry_max: 0,
      env_overrides: { DATASET: '2026-09' },
    });
    const description = asked().description;
    expect(description).toMatch(/billable/);
    expect(description).toMatch(/any not started by then are cancelled/);
    expect(description).toMatch(/tasks that have not started are cancelled/);
    expect(description).toMatch(/runs python --dataset 2026-09/);
    expect(description).toMatch(/0 retries/);
    expect(description).toMatch(/One environment variable is added/);
  });

  it('shows what each override inherits from the workload', async () => {
    const { dialog, options } = setup();
    await options();
    expect(within(dialog).getByLabelText('Parallel tasks')).toHaveAttribute(
      'placeholder',
      '10 (workload)'
    );
    expect(within(dialog).getByLabelText('Task timeout (seconds)')).toHaveAttribute(
      'placeholder',
      '900 (workload)'
    );
  });

  it('refuses a flexible run without a latest start, and reopens the options to show why', async () => {
    const { user, dialog, options, submit } = setup();
    await options();
    await user.click(within(dialog).getByLabelText(/Flexible start window/));
    await user.click(within(dialog).getByText('Run options'));
    await submit();
    expect(await within(dialog).findByText(/needs a latest start time/)).toBeVisible();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('keeps GREGALE_ variables for the platform', async () => {
    const { user, dialog, options, submit } = setup();
    await options();
    await user.type(within(dialog).getByLabelText('Environment for this run'), 'GREGALE_X=1');
    await submit();
    expect(await within(dialog).findByText(/GREGALE_ is reserved/)).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('runs with its own failure rules', async () => {
    const { user, dialog, options, submit } = setup();
    await options();
    await user.click(within(dialog).getByLabelText(/Use failure rules for this run only/));
    await user.click(within(dialog).getByRole('button', { name: 'Add rule' }));
    await user.selectOptions(within(dialog).getByLabelText('Rule 1 matches'), 'outcome');
    await user.type(within(dialog).getByLabelText('Rule 1 codes'), 'invalid_record');
    await submit();
    await waitFor(() => expect(startRun).toHaveBeenCalled());
    expect(sent().failure_rules).toEqual({
      version: 1,
      rules: [{ outcome_codes: ['invalid_record'], action: 'fail_partition' }],
      unmatched_failure: 'retry',
      uncertain_outcome: 'hold',
    });
    expect(asked().description).toMatch(/this run’s own rules/);
  });

  it('names the override that crossed a plan ceiling', async () => {
    startRun.mockRejectedValue(
      new ApiError({
        status: 403,
        code: 'job_quota_exceeded',
        title: 'Job limit reached',
        limit: 25,
        observed: 40,
      })
    );
    const { user, dialog, options, submit } = setup();
    await options();
    await user.type(within(dialog).getByLabelText('Parallel tasks'), '40');
    await submit();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Your plan allows up to 25 parallel tasks.'
    );
  });

  it('mints a new key when any option changes, not only the count', async () => {
    startRun.mockReset().mockRejectedValue(new TypeError('Failed to fetch'));
    const { user, dialog, options, submit } = setup();
    await submit();
    await within(dialog).findByRole('alert');
    await options();
    await user.click(within(dialog).getByLabelText(/Fail fast/));
    await submit();
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(2));
    const [first, second] = startRun.mock.calls.map(([v]) => v as { idempotencyKey: string });
    expect(second!.idempotencyKey).not.toBe(first!.idempotencyKey);
  });
});
