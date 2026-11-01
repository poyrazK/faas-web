import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  FIELD,
  FieldError,
  Select,
  fieldErrorProps,
  useFormValidation,
} from '@/components/ui/field';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { RELEASE_EVENTS, type ReleaseWebhook } from '@/lib/api/release-webhooks';
import { WEBHOOK_SECRET_MAX, utf8Bytes } from './rotate-secret-dialog';

const OFFERED: ReadonlySet<string> = new Set(RELEASE_EVENTS.map((e) => e.event));

export interface ReleaseWebhookValues {
  target: string;
  /**
   * Strings, not the spec's enum: a receiver may hold an event this form does
   * not offer (agent_run.finished, for accounts in the agent_runs rollout), and
   * an edit must keep it.
   */
  events: string[];
  retryPolicy: ReleaseWebhook['retry_policy'];
  format: ReleaseWebhook['delivery_format'];
  /** Create only: empty means the console generates one and shows it once. */
  ownSecret: string;
  /** Create only: start disabled, so nothing is sent before the receiver has the secret. */
  startPaused: boolean;
}

export const BLANK: ReleaseWebhookValues = {
  target: '',
  events: [],
  retryPolicy: 'default',
  format: 'json',
  ownSecret: '',
  startPaused: true,
};

function targetError(value: string): string | undefined {
  if (value.length > 2048) return 'Target URLs can be at most 2048 characters.';
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname) return undefined;
  } catch {
    // falls through to the message below
  }
  return 'Enter a complete HTTPS target URL.';
}

/** A create or edit refusal, worded by its code (faas errors.go:4724-4745). */
function Failure({ error }: { error: unknown }) {
  const code = error instanceof ApiError ? error.code : undefined;
  return (
    <p role="alert" className="text-xs text-[color:var(--status-critical)] sm:col-span-2">
      {code === 'plan_webhook_quota'
        ? 'Your plan’s webhook limit is reached. It is shared with app webhooks: delete one of either to add another. '
        : code === 'plan_webhooks_not_allowed'
          ? 'Your plan does not include outbound webhooks. '
          : errorMessage(error)}
      {(code === 'plan_webhook_quota' || code === 'plan_webhooks_not_allowed') && (
        <a className="text-brand underline" href="/dashboard/plans">
          View plans
        </a>
      )}
    </p>
  );
}

/**
 * The fields of a release receiver, for adding one and for editing one.
 *
 * Events are a closed, non-empty set: apid refuses an empty filter on an
 * account receiver so it never silently grows as new events ship (ADR-224).
 */
export function ReleaseWebhookForm({
  initial = BLANK,
  mode,
  busy,
  error,
  onSubmit,
}: {
  initial?: ReleaseWebhookValues;
  mode: 'create' | 'edit';
  busy: boolean;
  error?: unknown;
  /** Resolves true when the form should clear. */
  onSubmit: (values: ReleaseWebhookValues) => Promise<boolean>;
}) {
  const [values, setValues] = useState(initial);
  const validation = useFormValidation<'target' | 'events' | 'ownSecret'>();
  const set = (patch: Partial<ReleaseWebhookValues>) => setValues((v) => ({ ...v, ...patch }));
  const errors = {
    target: targetError(values.target.trim()),
    events: values.events.length ? undefined : 'Choose at least one event.',
    ownSecret:
      utf8Bytes(values.ownSecret) > WEBHOOK_SECRET_MAX
        ? `Secrets can be at most ${WEBHOOK_SECRET_MAX} bytes.`
        : undefined,
  };
  const shown: Partial<typeof errors> = validation.submitAttempted ? errors : {};
  // Events the form does not offer stay visible, and toggleable, while editing.
  const [extra] = useState(() => initial.events.filter((e) => !OFFERED.has(e)));
  const toggle = (event: string) => {
    const on = values.events.includes(event);
    const next = on ? values.events.filter((x) => x !== event) : [...values.events, event];
    // Offered events in the catalog's order, then the rest as they were.
    set({
      events: [
        ...RELEASE_EVENTS.map((e) => e.event).filter((e) => next.includes(e)),
        ...next.filter((e) => !OFFERED.has(e)),
      ],
    });
  };
  const chips = [
    ...RELEASE_EVENTS,
    ...extra.map((event) => ({ event, what: 'Not offered here; kept as it is.' })),
  ];
  const ids = {
    target: `${mode}-release-target`,
    events: `${mode}-release-events`,
    secret: `${mode}-release-secret`,
  };

  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!validation.validate(errors, e.currentTarget) || busy) return;
        void onSubmit({ ...values, target: values.target.trim() }).then((clear) => {
          if (!clear) return;
          setValues(BLANK);
          validation.resetValidation();
        });
      }}
    >
      <label className="flex flex-col gap-1.5 sm:col-span-2">
        <span className="label-mono text-muted-foreground">Target URL</span>
        <input
          name="target"
          maxLength={2048}
          value={values.target}
          onChange={(e) => set({ target: e.target.value })}
          {...fieldErrorProps(shown.target, ids.target)}
          placeholder="https://platform.example.com/gregale/releases"
          spellCheck={false}
          className={`${FIELD} font-mono`}
        />
        {shown.target && <FieldError id={ids.target}>{shown.target}</FieldError>}
      </label>
      <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
        <legend className="label-mono text-muted-foreground">Events</legend>
        <div className="flex flex-wrap gap-1.5 pt-1.5">
          {chips.map(({ event, what }) => {
            const on = values.events.includes(event);
            return (
              <button
                key={event}
                type="button"
                name={event === RELEASE_EVENTS[0].event ? 'events' : undefined}
                title={what}
                aria-pressed={on}
                aria-describedby={shown.events ? ids.events : undefined}
                onClick={() => toggle(event)}
                className={`h-8 rounded-md border px-2.5 font-mono text-xs pressable ${
                  on
                    ? 'border-brand bg-brand/10 text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {event}
              </button>
            );
          })}
        </div>
        {shown.events && <FieldError id={ids.events}>{shown.events}</FieldError>}
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Retries</span>
        <Select
          value={values.retryPolicy}
          onChange={(e) =>
            set({ retryPolicy: e.target.value as ReleaseWebhookValues['retryPolicy'] })
          }
        >
          <option value="default">default — 30 s to 6 h over 7 tries</option>
          <option value="aggressive">aggressive — 15 s to 3 h over 7 tries</option>
          <option value="none">none — one attempt</option>
        </Select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Format</span>
        <Select
          value={values.format}
          onChange={(e) => set({ format: e.target.value as ReleaseWebhookValues['format'] })}
        >
          <option value="json">Gregale JSON</option>
          <option value="cloudevents">CloudEvents 1.0 (structured)</option>
        </Select>
      </label>
      {mode === 'create' && (
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor={ids.secret + '-input'} className="label-mono text-muted-foreground">
            Your own secret (optional)
          </label>
          <input
            id={ids.secret + '-input'}
            name="ownSecret"
            type="password"
            value={values.ownSecret}
            onChange={(e) => set({ ownSecret: e.target.value })}
            {...fieldErrorProps(shown.ownSecret, ids.secret)}
            placeholder="Leave empty to generate one"
            autoComplete="new-password"
            className={`${FIELD} font-mono`}
          />
          {shown.ownSecret ? (
            <FieldError id={ids.secret}>{shown.ownSecret}</FieldError>
          ) : (
            <span className="text-xs text-muted-foreground">
              Left empty, a strong secret is generated and shown once after the receiver is added.
            </span>
          )}
        </div>
      )}
      {mode === 'create' && (
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.startPaused}
              onChange={(e) => set({ startPaused: e.target.checked })}
              className="h-3.5 w-3.5 accent-[color:var(--brand)]"
            />
            Start paused
          </label>
          <span className="text-xs text-muted-foreground">
            Until your receiver has the secret, every delivery fails its signature check, and with
            no retries it is lost. Turn the receiver on once the secret is installed; events while
            it is paused are not delivered.
          </span>
        </div>
      )}
      {error !== undefined && error !== null && <Failure error={error} />}
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" size="sm" busy={busy}>
          {mode === 'create' ? 'Add receiver' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
