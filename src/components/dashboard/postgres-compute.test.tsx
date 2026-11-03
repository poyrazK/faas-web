import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
const access = vi.hoisted(() => ({ compute: 'on' }));
const usePostgresCapabilities = vi.fn();
const usePostgresResize = vi.fn();
const usePostgresComputePolicyChange = vi.fn();
const resize = vi.fn();
const changePolicy = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: access.compute, refresh: vi.fn() }),
  useCapabilityStage: () => 'Beta',
}));
vi.mock('@/lib/api/postgres', () => ({
  usePostgresCapabilities: (region?: string) => usePostgresCapabilities(region) as unknown,
  usePostgresResize: (db: string, id: string) => usePostgresResize(db, id) as unknown,
  usePostgresComputePolicyChange: (db: string, id: string) =>
    usePostgresComputePolicyChange(db, id) as unknown,
  useResizePostgresDatabase: () => ({ mutateAsync: resize, isPending: false }),
  useChangePostgresComputePolicy: () => ({ mutateAsync: changePolicy, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { DatabaseCompute } = await import('./postgres-compute');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ready = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });
const idle = { data: undefined, isPending: true, error: null, refetch: vi.fn() };
const database = (over: Record<string, unknown> = {}) =>
  ({
    id: 'db1',
    name: 'orders',
    region: 'fra',
    postgres_major: 17,
    service_class: 'development',
    availability: 'single_zone',
    scale_to_zero: true,
    storage_limit_bytes: 5 * 1024 ** 3,
    restore_window_seconds: 7 * 86_400,
    state: 'ready',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  }) as never;
const capabilities = (over: Record<string, unknown> = {}) => ({
  contract_version: 1,
  region: 'fra',
  provisioning_enabled: true,
  database_limit: 3,
  postgres_majors: [15, 16, 17],
  service_classes: ['burstable', 'development'],
  availability: ['single_zone'],
  credential_access: ['read_write'],
  scale_to_zero: true,
  always_on: false,
  pooled_connections: true,
  point_in_time_restore: true,
  class_resize: true,
  scale_to_zero_update: true,
  storage_limit_bytes: 5 * 1024 ** 3,
  restore_window_seconds: 7 * 86_400,
  ...over,
});
const change = (over: Record<string, unknown> = {}) => ({
  id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  database_id: 'db1',
  from_class: 'development',
  target_class: 'burstable',
  generation: 2,
  state: 'pending',
  connection_interruption_expected: true,
  created_at: '2026-11-03T08:00:00Z',
  ...over,
});

let onOperation: ReturnType<typeof vi.fn<(operation: { kind: string; id: string }) => void>>;
beforeEach(() => {
  workspace.org = null;
  workspace.label = 'Personal';
  access.compute = 'on';
  usePostgresCapabilities.mockReset().mockReturnValue(ready(capabilities()));
  usePostgresResize.mockReset().mockReturnValue(idle);
  usePostgresComputePolicyChange.mockReset().mockReturnValue(idle);
  resize.mockReset().mockResolvedValue(change());
  changePolicy
    .mockReset()
    .mockResolvedValue(change({ from_scale_to_zero: false, target_scale_to_zero: true }));
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
  onOperation = vi.fn();
});

const renderCompute = (db = database(), operation?: { kind: 'resize' | 'policy'; id: string }) =>
  render(<DatabaseCompute database={db} operation={operation} onOperation={onOperation} />);

describe('DatabaseCompute', () => {
  it('is labelled Beta and says what a change keeps and what it may interrupt', () => {
    renderCompute();
    const section = screen.getByRole('region', { name: 'Compute' });
    expect(within(section).getByText('Beta')).toBeInTheDocument();
    expect(section).toHaveTextContent(/development class/i);
    expect(section).toHaveTextContent(/scales to zero when idle/i);
    expect(section).toHaveTextContent(/may be disconnected/i);
    expect(usePostgresCapabilities).toHaveBeenCalledWith('fra');
  });

  it('offers only the classes the plan includes', () => {
    renderCompute();
    const select = screen.getByLabelText('Target compute class');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Development (current)', 'Burstable']);
  });

  it('resizes after asking, with a fresh request id, and follows the change', async () => {
    renderCompute();
    await userEvent.selectOptions(screen.getByLabelText('Target compute class'), 'burstable');
    await userEvent.click(screen.getByRole('button', { name: /^resize$/i }));
    await waitFor(() =>
      expect(resize).toHaveBeenCalledWith({
        id: 'db1',
        request_id: expect.stringMatching(UUID) as string,
        service_class: 'burstable',
      })
    );
    const asked = confirm.mock.calls[0]![0] as { description: string };
    expect(asked.description).toMatch(/disconnected/i);
    expect(onOperation).toHaveBeenCalledWith({ kind: 'resize', id: change().id });
  });

  it('shows a pending resize, with its request id and any provider retry', () => {
    usePostgresResize.mockReturnValue(ready(change({ last_error_code: 'provider_timeout' })));
    renderCompute(database({ state: 'updating' }), { kind: 'resize', id: change().id });
    expect(usePostgresResize).toHaveBeenLastCalledWith('db1', change().id);
    expect(screen.getByText('Resizing')).toBeInTheDocument();
    expect(screen.getByText(/development → burstable/)).toBeInTheDocument();
    expect(screen.getByText('provider_timeout')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Copy: request ID ${change().id}` })).toBeVisible();
    expect(screen.getByRole('button', { name: /^resize$/i })).toBeDisabled();
  });

  it('says once that the resize finished', async () => {
    usePostgresResize.mockReturnValue(
      ready(change({ state: 'succeeded', completed_at: '2026-11-03T08:02:00Z' }))
    );
    const view = renderCompute(database({ service_class: 'burstable' }), {
      kind: 'resize',
      id: change().id,
    });
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'success', title: 'orders is now burstable' })
      )
    );
    expect(screen.getByText('Resized')).toBeInTheDocument();
    view.rerender(
      <DatabaseCompute
        database={database({ service_class: 'burstable' })}
        operation={{ kind: 'resize', id: change().id }}
        onOperation={onOperation}
      />
    );
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('replays the request id after an unknown outcome, and mints one after a refusal', async () => {
    resize
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(
        new ApiError({ status: 409, code: 'managed_postgres_conflict', title: 't', detail: 'd' })
      )
      .mockResolvedValue(change());
    renderCompute();
    await userEvent.selectOptions(screen.getByLabelText('Target compute class'), 'burstable');
    const button = screen.getByRole('button', { name: /^resize$/i });
    await userEvent.click(button);
    await waitFor(() => expect(resize).toHaveBeenCalledTimes(1));
    await userEvent.click(button);
    await waitFor(() => expect(resize).toHaveBeenCalledTimes(2));
    await userEvent.click(button);
    await waitFor(() => expect(resize).toHaveBeenCalledTimes(3));
    const ids = resize.mock.calls.map((c) => (c[0] as { request_id: string }).request_id);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[1]);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Another change is in progress' })
    );
  });

  it('explains why it cannot resize: one class in the plan, a region without it, not ready', () => {
    usePostgresCapabilities.mockReturnValue(
      ready(capabilities({ service_classes: ['development'], class_resize: false }))
    );
    const { unmount } = renderCompute();
    expect(screen.getByText(/plan includes only the development class/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^resize$/i })).toBeDisabled();
    unmount();
    usePostgresCapabilities.mockReturnValue(ready(capabilities({ class_resize: false })));
    const second = renderCompute();
    expect(screen.getByText(/cannot resize databases in fra/i)).toBeInTheDocument();
    second.unmount();
    usePostgresCapabilities.mockReturnValue(ready(capabilities()));
    renderCompute(database({ state: 'provisioning' }));
    expect(screen.getByText(/once the database is ready/i)).toBeInTheDocument();
  });

  it('offers a class the plan includes to resume a database the plan no longer includes', () => {
    renderCompute(database({ service_class: 'production', plan_excess: 'service_class' }));
    const options = within(screen.getByLabelText('Target compute class'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Development', 'Burstable', 'Production (current, not in plan)']);
  });

  describe('compute policy', () => {
    it('turns scale to zero on after asking, and follows the change', async () => {
      renderCompute(database({ scale_to_zero: false }));
      await userEvent.click(screen.getByRole('button', { name: /turn scale to zero on/i }));
      await waitFor(() =>
        expect(changePolicy).toHaveBeenCalledWith({
          id: 'db1',
          request_id: expect.stringMatching(UUID) as string,
          scale_to_zero: true,
        })
      );
      expect(onOperation).toHaveBeenCalledWith({ kind: 'policy', id: change().id });
    });

    it('does not offer always-on compute when the plan does not include it', () => {
      renderCompute();
      expect(screen.getByRole('button', { name: /keep it always on/i })).toBeDisabled();
      expect(screen.getByText(/always-on compute is not part of your plan/i)).toBeInTheDocument();
    });

    it('offers always-on compute when the plan includes it', async () => {
      usePostgresCapabilities.mockReturnValue(ready(capabilities({ always_on: true })));
      renderCompute();
      await userEvent.click(screen.getByRole('button', { name: /keep it always on/i }));
      await waitFor(() =>
        expect(changePolicy).toHaveBeenCalledWith(expect.objectContaining({ scale_to_zero: false }))
      );
    });

    it('shows a pending policy change', () => {
      usePostgresComputePolicyChange.mockReturnValue(
        ready(change({ from_scale_to_zero: false, target_scale_to_zero: true }))
      );
      renderCompute(database({ state: 'updating' }), { kind: 'policy', id: change().id });
      expect(screen.getByText('Changing compute policy')).toBeInTheDocument();
      expect(screen.getByText(/always on → scales to zero/)).toBeInTheDocument();
    });
  });

  it('is neither shown nor read while the capability is off', () => {
    access.compute = 'off';
    const { container } = renderCompute();
    expect(container).toBeEmptyDOMElement();
    expect(usePostgresResize).toHaveBeenLastCalledWith('db1', '');
  });
});
