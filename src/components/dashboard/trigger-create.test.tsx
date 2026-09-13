import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import { ApiError } from '@/lib/api/errors';
import type { Account } from '@/lib/auth';
import type { App } from '@/lib/api/queries';

const create = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/queries')>()),
  useCreateTrigger: () => ({ mutateAsync: create, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { CreateTrigger } = await import('./trigger-create');

const account = {
  plan: 'pro',
  limits: {
    plan: 'pro',
    triggers_allowed: true,
    trigger_kinds: ['kafka', 'nats', 'redis_streams', 'sqs_compat', 'queue'],
    trigger_limit_per_app: 10,
    trigger_limit_per_account: 50,
    trigger_batch_size_max: 500,
    trigger_batch_window_max_ms: 300_000,
    trigger_max_attempts_max: 10,
    trigger_payload_max_bytes: 6_291_456,
    trigger_tls_skip_verify_allowed: true,
  },
} as Account;
const apps = [{ id: 'app1', slug: 'api-gateway' }] as App[];

beforeEach(() => {
  create.mockReset().mockResolvedValue({ id: 't1', slug: 'orders-inbound' });
  toast.mockReset();
});

describe('CreateTrigger', () => {
  it('shows an upgrade route on Free and never submits', async () => {
    render(
      withRouter(
        <CreateTrigger
          account={{
            ...account,
            plan: 'free',
            limits: { ...account.limits, triggers_allowed: false, trigger_kinds: [] },
          }}
          apps={apps}
        />
      )
    );
    expect(await screen.findByText(/not included on your current plan/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /compare plans/i })).toHaveAttribute(
      'href',
      '/dashboard/plans'
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('requires an app before rendering the wizard', async () => {
    render(withRouter(<CreateTrigger account={account} apps={[]} />));
    expect(await screen.findByText(/create an app first/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create app/i })).toHaveAttribute(
      'href',
      '/dashboard/workflows/new'
    );
  });

  it('uses only the kinds in the account capability snapshot', async () => {
    const hobby = {
      ...account,
      plan: 'hobby',
      limits: {
        ...account.limits,
        plan: 'hobby',
        trigger_kinds: ['sqs_compat', 'queue'],
        trigger_batch_size_max: 50,
        trigger_batch_window_max_ms: 30_000,
        trigger_max_attempts_max: 3,
        trigger_payload_max_bytes: 1_048_576,
        trigger_tls_skip_verify_allowed: false,
      },
    } as Account;
    render(withRouter(<CreateTrigger account={hobby} apps={apps} />));
    const options = [
      ...(await screen.findByLabelText('Trigger kind')).querySelectorAll('option'),
    ].map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual(['sqs_compat', 'queue']);
  });

  it('does not advance until destination fields are valid', async () => {
    render(withRouter(<CreateTrigger account={account} apps={apps} />));
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect(screen.getByText(/lower-case letters/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Trigger slug')).toHaveFocus();
    expect(screen.queryByLabelText('Brokers')).not.toBeInTheDocument();
  });

  it('reviews the handler contract and submits explicit plan-safe values', async () => {
    render(withRouter(<CreateTrigger account={account} apps={apps} />));
    await userEvent.type(await screen.findByLabelText('Trigger slug'), 'orders-inbound');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.type(screen.getByLabelText('Brokers'), 'broker:9092');
    await userEvent.type(screen.getByLabelText('Topic'), 'orders');
    await userEvent.type(screen.getByLabelText('Consumer group'), 'gregale');
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('POST /_triggers/kafka/orders-inbound')).toBeInTheDocument();
    expect(screen.getByText(/batchItemFailures/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /create trigger/i }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          app_id: 'app1',
          kind: 'kafka',
          slug: 'orders-inbound',
          batch_size_max: 64,
          batch_window_ms: 1000,
          max_attempts: 5,
          payload_max_bytes: 6_291_456,
          enabled: true,
        })
      )
    );
  });

  it.each([
    ['trigger_kind_not_allowed', /not available on this plan/i],
    ['plan_trigger_quota', /plan limit/i],
    ['trigger_batch_window_too_large', /batch window/i],
    ['trigger_tls_skip_verify_not_allowed', /tls verification/i],
    ['trigger_invalid_config', /broker rejected/i],
    ['secret_store_unavailable', /credential store/i],
  ])('keeps the populated flow and explains %s', async (code, recovery) => {
    create.mockRejectedValue(
      new ApiError({ status: 422, code, title: 'Rejected', detail: 'server detail' })
    );
    render(withRouter(<CreateTrigger account={account} apps={apps} />));
    await userEvent.type(await screen.findByLabelText('Trigger slug'), 'orders');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.type(screen.getByLabelText('Brokers'), 'b:9092');
    await userEvent.type(screen.getByLabelText('Topic'), 'orders');
    await userEvent.type(screen.getByLabelText('Consumer group'), 'g');
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    await userEvent.click(screen.getByRole('button', { name: /create trigger/i }));
    expect(await screen.findByText(recovery)).toBeInTheDocument();
    expect(screen.getByText('orders')).toBeInTheDocument();
  });
});
