import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useCreateJob: () => ({ mutateAsync: create, isPending: false, error: null }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { JobCreateDialog } = await import('./job-create-dialog');

beforeEach(() => {
  create
    .mockReset()
    .mockImplementation((body: Record<string, unknown>) => Promise.resolve({ id: 'j1', ...body }));
  toast.mockReset();
});

async function fillBasics() {
  await userEvent.type(screen.getByLabelText('Name'), 'nightly-export');
  await userEvent.type(screen.getByLabelText('Container image'), 'ghcr.io/acme/export:v1');
  await userEvent.type(screen.getByLabelText('Executable'), 'python');
}

describe('JobCreateDialog schedule', () => {
  it('asks for no schedule for a batch workload', async () => {
    render(<JobCreateDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.queryByLabelText('Schedule')).not.toBeInTheDocument();
    await fillBasics();
    await userEvent.click(screen.getByRole('button', { name: 'Create workload' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).not.toHaveProperty('schedule');
  });

  it('requires a schedule for a recurring workload, as apid does', async () => {
    render(<JobCreateDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    await fillBasics();
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'recurring');
    await userEvent.click(screen.getByRole('button', { name: 'Create workload' }));
    expect(await screen.findByText(/five-field cron/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('sends the schedule, its zone and an opted-in policy', async () => {
    const onCreated = vi.fn();
    render(<JobCreateDialog onClose={vi.fn()} onCreated={onCreated} />);
    await fillBasics();
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'recurring');
    await userEvent.type(screen.getByLabelText('Schedule'), '*/5 * * * *');
    await userEvent.click(screen.getByLabelText(/Apply a schedule policy/));
    await userEvent.selectOptions(screen.getByLabelText('Overlap'), 'skip');
    await userEvent.type(screen.getByLabelText(/Start deadline/), '120');
    await userEvent.click(screen.getByRole('button', { name: 'Create workload' }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'recurring',
          schedule: '*/5 * * * *',
          timezone: 'UTC',
          schedule_policy: {
            version: 1,
            overlap: 'skip',
            missed_runs: 'skip',
            start_deadline_seconds: 120,
          },
        })
      )
    );
    expect(onCreated).toHaveBeenCalled();
  });

  it('sends no policy unless one is chosen', async () => {
    render(<JobCreateDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    await fillBasics();
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'recurring');
    await userEvent.type(screen.getByLabelText('Schedule'), '0 3 * * *');
    await userEvent.click(screen.getByRole('button', { name: 'Create workload' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).not.toHaveProperty('schedule_policy');
  });
});
