import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import { ApiError } from '@/lib/api/errors';

const useApps = vi.fn();
const create = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useApps: () => useApps() as unknown,
  useCreateTrigger: () => ({ mutateAsync: create, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { CreateTrigger, buildConfig, validateConfig } = await import('./trigger-create');

beforeEach(() => {
  useApps.mockReset().mockReturnValue({
    data: [{ id: 'app1', slug: 'api-gateway' }],
    isPending: false,
    error: null,
  });
  create.mockReset().mockResolvedValue({ id: 't1', slug: 'orders-inbound' });
  toast.mockReset();
});

describe('validateConfig', () => {
  it('demands what the server demands, per kind', () => {
    expect(validateConfig('kafka', {})).toEqual({
      brokers: expect.any(String),
      topic: expect.any(String),
      group: expect.any(String),
    });
    expect(Object.keys(validateConfig('nats', {}))).toEqual([
      'url',
      'stream',
      'subject',
      'durable',
    ]);
    expect(Object.keys(validateConfig('redis_streams', {}))).toEqual(['addr', 'stream', 'group']);
    expect(validateConfig('queue', {})).toEqual({});
  });

  it('rejects the URL schemes the server rejects', () => {
    expect(
      validateConfig('nats', { url: 'http://x', stream: 's', subject: 'a', durable: 'd' }).url
    ).toMatch(/nats:\/\/ or tls:\/\//);
    expect(validateConfig('sqs_compat', { queue_url: 'ftp://x' }).queue_url).toMatch(/http/);
    expect(
      validateConfig('sqs_compat', { queue_url: 'https://q.example', long_poll_secs: '30' })
        .long_poll_secs
    ).toMatch(/1 and 20/);
  });
});

describe('buildConfig', () => {
  it('splits the broker list and omits SASL when no credentials were given', () => {
    expect(buildConfig('kafka', { brokers: 'a:9092, b:9092', topic: 't', group: 'g' })).toEqual({
      brokers: ['a:9092', 'b:9092'],
      topic: 't',
      group: 'g',
    });
  });

  it('includes SASL once a username is present', () => {
    const c = buildConfig('kafka', {
      brokers: 'a:9092',
      topic: 't',
      group: 'g',
      sasl_username: 'svc',
      sasl_password: 'pw',
    });
    expect(c.sasl).toEqual({ mechanism: 'scram-sha-256', username: 'svc', password: 'pw' });
  });

  it('sends long_poll_secs as a number, and drops it when blank', () => {
    expect(buildConfig('sqs_compat', { queue_url: 'https://q', long_poll_secs: '10' })).toEqual({
      queue_url: 'https://q',
      long_poll_secs: 10,
    });
    expect(buildConfig('sqs_compat', { queue_url: 'https://q' })).toEqual({
      queue_url: 'https://q',
    });
  });
});

describe('CreateTrigger', () => {
  it('does not offer cron, which this endpoint refuses, and points at Crons instead', async () => {
    render(withRouter(<CreateTrigger />));
    const kinds = [
      ...(await screen.findByLabelText('Trigger kind')).querySelectorAll('option'),
    ].map((o) => (o as HTMLOptionElement).value);
    expect(kinds).toEqual(['kafka', 'nats', 'redis_streams', 'sqs_compat', 'queue']);
    expect(screen.getByRole('link', { name: /create a cron/i })).toBeInTheDocument();
  });

  it('sends the app, kind, slug and the shaped config', async () => {
    render(withRouter(<CreateTrigger />));
    await userEvent.type(await screen.findByLabelText('Trigger slug'), 'orders-inbound');
    await userEvent.type(screen.getByLabelText('Brokers'), 'broker:9092');
    await userEvent.type(screen.getByLabelText('Topic'), 'orders');
    await userEvent.type(screen.getByLabelText('Consumer group'), 'gregale');
    await userEvent.click(screen.getByRole('button', { name: /create trigger/i }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        app_id: 'app1',
        kind: 'kafka',
        slug: 'orders-inbound',
        config: { brokers: ['broker:9092'], topic: 'orders', group: 'gregale' },
      })
    );
  });

  it('swaps the fields when the source changes', async () => {
    render(withRouter(<CreateTrigger />));
    await userEvent.selectOptions(await screen.findByLabelText('Trigger kind'), 'redis_streams');
    expect(screen.getByLabelText('Address')).toBeInTheDocument();
    expect(screen.queryByLabelText('Brokers')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Trigger kind'), 'queue');
    expect(screen.getByLabelText('Queue mode')).toBeInTheDocument();
  });

  it('will not submit an incomplete config, and says which field is missing', async () => {
    render(withRouter(<CreateTrigger />));
    await userEvent.type(await screen.findByLabelText('Trigger slug'), 'x');
    await userEvent.click(screen.getByRole('button', { name: /create trigger/i }));
    expect(await screen.findByText(/at least one broker/i)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('repeats the server’s reason when it rejects the config', async () => {
    create.mockRejectedValue(
      new ApiError({
        status: 422,
        code: 'trigger_invalid_config',
        title: 'Invalid trigger config',
        detail: 'kafka config requires non-empty group',
      })
    );
    render(withRouter(<CreateTrigger />));
    await userEvent.type(await screen.findByLabelText('Trigger slug'), 'orders');
    await userEvent.type(screen.getByLabelText('Brokers'), 'b:9092');
    await userEvent.type(screen.getByLabelText('Topic'), 't');
    await userEvent.type(screen.getByLabelText('Consumer group'), 'g');
    await userEvent.click(screen.getByRole('button', { name: /create trigger/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'kafka config requires non-empty group' })
    );
  });

  it('reads a quota refusal as a limit rather than a failure', async () => {
    create.mockRejectedValue(
      new ApiError({ status: 403, code: 'trigger_quota_exceeded', title: 'Too many' })
    );
    render(withRouter(<CreateTrigger />));
    await userEvent.type(await screen.findByLabelText('Trigger slug'), 'orders');
    await userEvent.type(screen.getByLabelText('Brokers'), 'b:9092');
    await userEvent.type(screen.getByLabelText('Topic'), 't');
    await userEvent.type(screen.getByLabelText('Consumer group'), 'g');
    await userEvent.click(screen.getByRole('button', { name: /create trigger/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'info', title: 'Trigger limit reached' })
      )
    );
  });
});
