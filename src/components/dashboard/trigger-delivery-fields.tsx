import type { ReactNode } from 'react';
import { FieldError, Select, Textarea } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { BrokerKind, TriggerDeliveryDraft, TriggerLimits } from './trigger-form-model';

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = `trigger-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-error`;
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
      {error ? (
        <FieldError id={id}>{error}</FieldError>
      ) : hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export function TriggerDeliveryFields({
  sourceKind,
  delivery,
  filterCriteriaText,
  errors,
  limits,
  onDeliveryChange,
  onFilterChange,
}: {
  sourceKind: BrokerKind;
  delivery: TriggerDeliveryDraft;
  filterCriteriaText: string;
  errors: Record<string, string>;
  limits: TriggerLimits;
  onDeliveryChange: (delivery: TriggerDeliveryDraft) => void;
  onFilterChange: (value: string) => void;
}) {
  const patch = (values: Partial<TriggerDeliveryDraft>) =>
    onDeliveryChange({ ...delivery, ...values });
  const number = (key: keyof TriggerDeliveryDraft, value: string) =>
    patch({ [key]: value === '' ? 0 : Number(value) });
  const invalid = (key: string) => Boolean(errors[key]) || undefined;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field
          label="Maximum batch size"
          error={errors.batchSizeMax}
          hint={`Plan maximum: ${limits.trigger_batch_size_max}.`}
        >
          <Input
            type="number"
            min={1}
            max={limits.trigger_batch_size_max}
            aria-label="Maximum batch size"
            aria-invalid={invalid('batchSizeMax')}
            value={delivery.batchSizeMax}
            onChange={(event) => number('batchSizeMax', event.target.value)}
          />
        </Field>
        <Field
          label="Batch window (ms)"
          error={errors.batchWindowMs}
          hint={`Plan maximum: ${limits.trigger_batch_window_max_ms} ms.`}
        >
          <Input
            type="number"
            min={10}
            max={limits.trigger_batch_window_max_ms}
            aria-label="Batch window (ms)"
            aria-invalid={invalid('batchWindowMs')}
            value={delivery.batchWindowMs}
            onChange={(event) => number('batchWindowMs', event.target.value)}
          />
        </Field>
        <Field
          label="Maximum attempts"
          error={errors.maxAttempts}
          hint={`Plan maximum: ${limits.trigger_max_attempts_max}.`}
        >
          <Input
            type="number"
            min={1}
            max={limits.trigger_max_attempts_max}
            aria-label="Maximum attempts"
            aria-invalid={invalid('maxAttempts')}
            value={delivery.maxAttempts}
            onChange={(event) => number('maxAttempts', event.target.value)}
          />
        </Field>
        <Field
          label="Payload cap (bytes)"
          error={errors.payloadMaxBytes}
          hint={`Plan maximum: ${limits.trigger_payload_max_bytes} bytes.`}
        >
          <Input
            type="number"
            min={1024}
            max={limits.trigger_payload_max_bytes}
            aria-label="Payload cap (bytes)"
            aria-invalid={invalid('payloadMaxBytes')}
            value={delivery.payloadMaxBytes}
            onChange={(event) => number('payloadMaxBytes', event.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Field
          label="Filter criteria"
          error={errors.filterCriteriaText}
          hint="Optional JSON filter. Configuration shape is validated before saving."
        >
          <Textarea
            aria-label="Filter criteria"
            aria-invalid={invalid('filterCriteriaText')}
            className="min-h-32 font-mono text-xs"
            placeholder={'{"payload":[{"path":"$.type","equals":"order"}]}'}
            value={filterCriteriaText}
            onChange={(event) => onFilterChange(event.target.value)}
          />
        </Field>
        <div className="flex flex-col gap-4">
          {sourceKind === 'kafka' && (
            <Field
              label="Poison record strategy"
              error={errors.poisonStrategy}
              hint="Commit advances the broker offset; seek retries from that offset."
            >
              <Select
                aria-label="Poison record strategy"
                value={delivery.poisonStrategy}
                onChange={(event) =>
                  patch({
                    poisonStrategy: event.target.value as TriggerDeliveryDraft['poisonStrategy'],
                  })
                }
              >
                <option value="commit">Commit and route to dead letter</option>
                <option value="seek-to-offset">Seek to the failed offset</option>
              </Select>
            </Field>
          )}
          <label className="flex items-center justify-between gap-4 rounded-md border border-border bg-background px-3 py-3 text-sm">
            <span>
              <span className="block font-medium">Start consuming immediately</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Turn this off to create the trigger paused.
              </span>
            </span>
            <Switch
              checked={delivery.enabled}
              onCheckedChange={(checked) => patch({ enabled: checked })}
              aria-label="Start consuming immediately"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
