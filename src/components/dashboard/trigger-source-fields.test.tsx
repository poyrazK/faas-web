import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TriggerSourceFields } from './trigger-source-fields';
import { sourceDraft, type TriggerLimits, type TriggerSourceDraft } from './trigger-form-model';

const limits = {
  trigger_tls_skip_verify_allowed: true,
} as TriggerLimits;

function Harness({ initial }: { initial: TriggerSourceDraft }) {
  const [source, setSource] = useState(initial);
  return <TriggerSourceFields source={source} errors={{}} limits={limits} onChange={setSource} />;
}

describe('TriggerSourceFields', () => {
  it('progressively discloses Kafka TLS and SASL controls with write-only secrets', async () => {
    render(<Harness initial={sourceDraft('kafka')} />);
    expect(screen.getByLabelText('Brokers')).toBeInTheDocument();
    expect(screen.getByLabelText('Topic')).toBeInTheDocument();
    expect(screen.getByLabelText('Consumer group')).toBeInTheDocument();
    const advanced = screen.getByRole('button', { name: /tls and sasl/i });
    expect(advanced).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(advanced);
    await userEvent.click(screen.getByRole('switch', { name: /use tls/i }));
    expect(screen.getByLabelText('CA certificate')).toBeInTheDocument();
    expect(screen.getByLabelText('Client certificate')).toBeInTheDocument();
    expect(screen.getByLabelText('Client key')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('switch', { name: /skip tls verification/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: /use sasl/i }));
    expect(screen.getByLabelText('SASL mechanism')).toBeInTheDocument();
    expect(screen.getByLabelText('SASL username')).toBeInTheDocument();
    expect(screen.getByLabelText('SASL password')).toHaveAttribute('type', 'password');
  });

  it('hides skip verify when the account capability is false', async () => {
    const [source] = [sourceDraft('kafka')];
    render(
      <TriggerSourceFields
        source={source}
        errors={{}}
        limits={{ ...limits, trigger_tls_skip_verify_allowed: false }}
        onChange={() => undefined}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /tls and sasl/i }));
    expect(
      screen.queryByRole('switch', { name: /skip tls verification/i })
    ).not.toBeInTheDocument();
  });

  it.each([
    ['nats', ['NATS URL', 'Stream', 'Subject', 'Durable name']],
    ['redis_streams', ['Redis address', 'Stream', 'Consumer group']],
    ['sqs_compat', ['Queue URL', 'Long poll (seconds)']],
    ['queue', ['Queue mode']],
  ] as const)('renders only %s source fields', (kind, labels) => {
    render(<Harness initial={sourceDraft(kind)} />);
    for (const label of labels) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.queryByLabelText('Brokers')).not.toBeInTheDocument();
  });
});
