import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TriggerDeliveryFields } from './trigger-delivery-fields';
import { newTriggerDraft, type TriggerLimits } from './trigger-form-model';

const limits = {
  triggers_allowed: true,
  trigger_kinds: ['kafka'],
  trigger_batch_size_max: 500,
  trigger_batch_window_max_ms: 300_000,
  trigger_max_attempts_max: 10,
  trigger_payload_max_bytes: 6_291_456,
  trigger_tls_skip_verify_allowed: true,
} as TriggerLimits;

describe('TriggerDeliveryFields', () => {
  it('exposes account caps as native input boundaries', () => {
    const draft = newTriggerDraft(limits, 'app-1');
    render(
      <TriggerDeliveryFields
        sourceKind="kafka"
        delivery={draft.delivery}
        filterCriteriaText="{bad"
        errors={{ filterCriteriaText: 'Enter a valid JSON object.' }}
        limits={limits}
        onDeliveryChange={() => undefined}
        onFilterChange={() => undefined}
      />
    );
    expect(screen.getByLabelText('Maximum batch size')).toHaveAttribute('min', '1');
    expect(screen.getByLabelText('Maximum batch size')).toHaveAttribute('max', '500');
    expect(screen.getByLabelText('Batch window (ms)')).toHaveAttribute('min', '10');
    expect(screen.getByLabelText('Batch window (ms)')).toHaveAttribute('max', '300000');
    expect(screen.getByLabelText('Maximum attempts')).toHaveAttribute('max', '10');
    expect(screen.getByLabelText('Payload cap (bytes)')).toHaveAttribute('min', '1024');
    expect(screen.getByLabelText('Payload cap (bytes)')).toHaveAttribute('max', '6291456');
    expect(screen.getByLabelText('Poison record strategy')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Start consuming immediately' })).toBeInTheDocument();
    expect(screen.getByText('Enter a valid JSON object.')).toBeInTheDocument();
  });

  it('does not offer Kafka poison handling to other sources', () => {
    const draft = newTriggerDraft(limits, 'app-1');
    render(
      <TriggerDeliveryFields
        sourceKind="queue"
        delivery={draft.delivery}
        filterCriteriaText=""
        errors={{}}
        limits={limits}
        onDeliveryChange={() => undefined}
        onFilterChange={() => undefined}
      />
    );
    expect(screen.queryByLabelText('Poison record strategy')).not.toBeInTheDocument();
  });
});
