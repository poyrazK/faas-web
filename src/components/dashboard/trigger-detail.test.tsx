import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import { ApiError } from '@/lib/api/errors';
import type { Account } from '@/lib/auth';
import type { App } from '@/lib/api/queries';

const useTrigger = vi.fn();
const update = vi.fn();
const remove = vi.fn();
const enabled = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useTrigger: (id: string) => useTrigger(id),
  useTriggerMetrics: () => ({
    data: {
      pending_count: 1,
      claimed_count: 2,
      succeeded_count: 3,
      retry_count: 4,
      dead_letter_count: 5,
    },
    isPending: false,
    error: null,
  }),
  useUpdateTrigger: () => ({ mutateAsync: update, isPending: false }),
  useDeleteTrigger: () => ({ mutateAsync: remove, isPending: false }),
  useSetTriggerEnabled: () => ({ mutateAsync: enabled, isPending: false }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('./trigger-records', () => ({ TriggerRecords: () => <p>Record activity</p> }));
vi.mock('./trigger-dlq', () => ({ TriggerDeadLetter: () => <p>Dead-letter activity</p> }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { TriggerDetail } = await import('./trigger-detail');

const account = {
  limits: {
    triggers_allowed: true,
    trigger_kinds: ['kafka', 'nats', 'redis_streams', 'sqs_compat', 'queue'],
    trigger_batch_size_max: 500,
    trigger_batch_window_max_ms: 300_000,
    trigger_max_attempts_max: 10,
    trigger_payload_max_bytes: 6_291_456,
    trigger_tls_skip_verify_allowed: true,
  },
} as Account;
const apps = [{ id: 'app1', slug: 'orders-api' }] as App[];
const trigger = {
  id: 'trg1',
  account_id: 'acct',
  app_id: 'app1',
  kind: 'kafka',
  slug: 'orders-inbound',
  enabled: false,
  config: {
    brokers: ['broker:9092'],
    topic: 'orders',
    group: 'gregale',
    sasl: {
      mechanism: 'SCRAM-SHA-256',
      username: 'service',
      password_set: true,
      password_sealed: 'malicious-ciphertext',
    },
    tls: { client_cert: 'cert', client_key_set: true, client_key_sealed: 'secret-key' },
  },
  batch_size_max: 10,
  batch_window_ms: 2000,
  max_attempts: 5,
  payload_max_bytes: 262144,
  broker_poison_strategy: 'commit',
  filter_criteria: { payload: [{ path: '$.type', equals: 'order.created' }] },
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-05T00:00:00Z',
};

beforeEach(() => {
  useTrigger.mockReset().mockReturnValue({ data: trigger, isPending: false, error: null });
  update.mockReset().mockResolvedValue(trigger);
  remove.mockReset().mockResolvedValue({});
  enabled.mockReset().mockResolvedValue(trigger);
  confirm.mockReset().mockResolvedValue(true);
});

describe('TriggerDetail', () => {
  it('projects operations, delivery, handler contract, and redacted credentials', async () => {
    render(withRouter(<TriggerDetail triggerId="trg1" account={account} apps={apps} />));
    expect(await screen.findByRole('heading', { name: 'orders-inbound' })).toBeInTheDocument();
    expect(screen.getByText(/orders-api/)).toBeInTheDocument();
    expect(screen.getByText('POST /_triggers/kafka/orders-inbound')).toBeInTheDocument();
    expect(screen.getByText(/batchItemFailures/)).toBeInTheDocument();
    expect(screen.getByText('Password configured')).toBeInTheDocument();
    expect(screen.getByText('Client key configured')).toBeInTheDocument();
    expect(
      screen.queryByText(/malicious-ciphertext|secret-key|password_sealed|client_key_sealed/)
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Record activity' })).toBeInTheDocument();
  });

  it('keeps loading, missing, and errors distinct', async () => {
    useTrigger.mockReturnValue({ data: undefined, isPending: true, error: null });
    const first = render(
      withRouter(<TriggerDetail triggerId="trg1" account={account} apps={apps} />)
    );
    expect(await screen.findByText(/reading the trigger/i)).toBeInTheDocument();
    first.unmount();
    useTrigger.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({ status: 404, code: 'trigger_not_found', title: 'Gone' }),
    });
    render(withRouter(<TriggerDetail triggerId="trg1" account={account} apps={apps} />));
    expect(await screen.findByText(/no longer exists/i)).toBeInTheDocument();
  });

  it('edits delivery with locked identity and plan caps', async () => {
    render(withRouter(<TriggerDetail triggerId="trg1" account={account} apps={apps} />));
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Destination app')).toBeDisabled();
    expect(screen.getByLabelText('Trigger kind')).toBeDisabled();
    expect(screen.getByLabelText('Trigger slug')).toBeDisabled();
    expect(screen.getByLabelText('Maximum batch size')).toHaveAttribute('max', '500');
    expect(screen.getByText(/password configured/i)).toBeInTheDocument();
  });

  it('confirms destructive deletion before calling the API', async () => {
    render(withRouter(<TriggerDetail triggerId="trg1" account={account} apps={apps} />));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ typeToConfirm: 'orders-inbound' })
    );
    expect(remove).toHaveBeenCalledWith('trg1');
  });
});
