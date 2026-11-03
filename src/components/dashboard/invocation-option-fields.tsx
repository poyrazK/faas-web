import { useId, useState } from 'react';
import { FIELD as BASE_FIELD, FieldError, Select, fieldErrorProps } from '@/components/ui/field';
import { useAuth } from '@/lib/auth';
import {
  DURATION_UNITS,
  MAX_ATTEMPTS,
  invocationLimits,
  retryDraftErrors,
  type DurationDraft,
  type DurationUnit,
  type RetryDraft,
} from '@/lib/invocation-options';

const FIELD = `${BASE_FIELD} w-full`;

const RETRY_FIELDS: {
  key: keyof RetryDraft;
  label: string;
  step: string;
  placeholder: (cap: number | undefined) => string;
}[] = [
  {
    key: 'maxAttempts',
    label: 'Max attempts',
    step: '1',
    placeholder: (cap) => (cap ? `Plan cap (${cap})` : 'Plan cap'),
  },
  { key: 'baseSeconds', label: 'First retry after (s)', step: 'any', placeholder: () => '1' },
  { key: 'maxSeconds', label: 'Longest wait (s)', step: 'any', placeholder: () => 'No ceiling' },
  { key: 'jitter', label: 'Jitter (±%)', step: 'any', placeholder: () => '0' },
];

/**
 * The four knobs of a durable retry curve (faas RetryPolicyDTO). Blank means
 * "not set", so the next layer decides: the app default for an invocation, the
 * plan for the app default. A field complains only once it has been left.
 */
export function RetryPolicyFields({
  value,
  onChange,
  disabled = false,
}: {
  value: RetryDraft;
  onChange: (next: RetryDraft) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const { account } = useAuth();
  const cap = invocationLimits(account?.plan)?.maxAttempts;
  const [left, setLeft] = useState<Partial<Record<keyof RetryDraft, boolean>>>({});
  const errors = retryDraftErrors(value);
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" disabled={disabled}>
      <legend className="label-mono mb-2 text-muted-foreground">Retries</legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {RETRY_FIELDS.map((field) => {
          const error = left[field.key] ? errors[field.key] : undefined;
          const errorId = `${id}-${field.key}-error`;
          return (
            <label key={field.key} className="flex min-w-0 flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{field.label}</span>
              <input
                type="number"
                inputMode="decimal"
                min={field.key === 'maxAttempts' ? 1 : 0}
                max={
                  field.key === 'maxAttempts'
                    ? MAX_ATTEMPTS
                    : field.key === 'jitter'
                      ? 100
                      : undefined
                }
                step={field.step}
                aria-label={field.label}
                placeholder={field.placeholder(cap)}
                value={value[field.key]}
                onChange={(e) => onChange({ ...value, [field.key]: e.target.value })}
                onBlur={() => setLeft((prev) => ({ ...prev, [field.key]: true }))}
                className={`${FIELD} [font-variant-numeric:tabular-nums]`}
                {...fieldErrorProps(error, errorId)}
              />
              {error && <FieldError id={errorId}>{error}</FieldError>}
            </label>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Attempts include the first one
        {cap ? `; your plan allows up to ${cap}, and more is capped there` : ''}. Each retry waits
        twice as long as the last, up to the longest wait. Blank fields keep the default.
      </p>
    </fieldset>
  );
}

const UNIT_LABELS: Record<DurationUnit, string> = {
  seconds: 'seconds',
  minutes: 'minutes',
  hours: 'hours',
  days: 'days',
};

/** An amount and a unit, sent as whole seconds (`durationSeconds`). */
export function DurationField({
  label,
  value,
  onChange,
  hint,
  error,
  placeholder,
  units = Object.keys(DURATION_UNITS) as DurationUnit[],
}: {
  label: string;
  value: DurationDraft;
  onChange: (next: DurationDraft) => void;
  hint?: string;
  error?: string;
  placeholder?: string;
  units?: DurationUnit[];
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={`${id}-amount`} className="label-mono text-muted-foreground">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={`${id}-amount`}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          placeholder={placeholder}
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
          className={`${FIELD} min-w-0 [font-variant-numeric:tabular-nums]`}
          {...fieldErrorProps(error, errorId)}
        />
        <Select
          aria-label={`${label} unit`}
          value={value.unit}
          onChange={(e) => onChange({ ...value, unit: e.target.value as DurationUnit })}
          className="w-28 shrink-0"
        >
          {units.map((unit) => (
            <option key={unit} value={unit}>
              {UNIT_LABELS[unit]}
            </option>
          ))}
        </Select>
      </div>
      {error && <FieldError id={errorId}>{error}</FieldError>}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}
