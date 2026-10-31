import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError, Textarea, fieldErrorProps, useFormValidation } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useMfa } from '@/components/auth/mfa-provider';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  BILLING_IDENTITY_MAX_BYTES,
  useAccountRecord,
  useUpdateBillingIdentity,
  utf8Bytes,
  type BillingIdentityField,
  type BillingIdentityPatch,
} from '@/lib/api/billing-identity';
import { InlinePhase, Panel, queryPhase } from './primitives';

type Draft = Record<BillingIdentityField, string>;

const FIELDS: { name: BillingIdentityField; label: string; multiline?: boolean; hint?: string }[] =
  [
    { name: 'business_name', label: 'Legal name' },
    { name: 'billing_address', label: 'Billing address', multiline: true },
    {
      name: 'tax_id',
      label: 'Tax ID',
      // apid keeps one untyped identifier and hands it to Stripe as an EU VAT
      // number (faas pkg/billing/stripe/products.go:126-155); it checks no format.
      hint: 'An EU VAT number with its country prefix, for example DE123456789.',
    },
  ];

function draftFrom(account: Partial<Draft> | undefined): Draft {
  return {
    business_name: account?.business_name ?? '',
    billing_address: account?.billing_address ?? '',
    tax_id: account?.tax_id ?? '',
  };
}

/** Only the fields that differ once trimmed, as apid compares them. */
function changes(saved: Draft, draft: Draft): BillingIdentityPatch {
  const body: BillingIdentityPatch = {};
  for (const { name } of FIELDS) {
    const next = draft[name].trim();
    if (next !== saved[name]) body[name] = next;
  }
  return body;
}

function limitError(name: BillingIdentityField, label: string, value: string) {
  const max = BILLING_IDENTITY_MAX_BYTES[name];
  return utf8Bytes(value.trim()) > max ? `${label} must be at most ${max} bytes.` : undefined;
}

/**
 * The legal identity apid prints on invoices, from `PATCH /v1/account/billing`.
 *
 * It applies to invoices issued after the save: apid stores it on the account
 * and syncs it to the provider customer best-effort, so issued documents keep
 * what they were issued with. The write needs an admin session and a step-up
 * within five minutes (faas pkg/apid/apidserver/server.go:2080), which this
 * runs through the MFA modal and then replays under the same idempotency key.
 */
export function BillingIdentityPanel() {
  const query = useAccountRecord();
  const [editing, setEditing] = useState(false);
  const saved = draftFrom(query.data);
  const ready = !query.isPending && !query.error && query.data !== undefined;

  return (
    <Panel
      title="Billing identity"
      description="The legal name, address and tax ID printed on invoices. Changes apply to invoices issued from now on; issued invoices keep the details they were issued with."
      actions={
        ready && !editing ? (
          <Button
            size="sm"
            variant="outline"
            aria-label="Edit billing identity"
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        ) : undefined
      }
    >
      {!ready ? (
        <InlinePhase
          phase={queryPhase({ error: query.error, loading: query.isPending })}
          error={query.error}
          loadingMessage="Reading billing identity…"
          onRetry={() => void query.refetch()}
        />
      ) : editing ? (
        <BillingIdentityForm saved={saved} onDone={() => setEditing(false)} />
      ) : (
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
          {FIELDS.map(({ name, label }) => (
            <div key={name} className="contents">
              <dt className="text-xs font-medium text-muted-foreground sm:pt-0.5">{label}</dt>
              <dd className="min-w-0 break-words whitespace-pre-line">
                {saved[name] || <span className="text-muted-foreground">Not set</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}

function BillingIdentityForm({ saved, onDone }: { saved: Draft; onDone: () => void }) {
  const { toast } = useToast();
  const { openMfa } = useMfa();
  const mutation = useUpdateBillingIdentity();
  const validation = useFormValidation<BillingIdentityField>();
  const [draft, setDraft] = useState<Draft>(saved);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formId = useId();
  // One key per logical save, kept across the step-up retry.
  const key = useRef<string | null>(null);

  const body = changes(saved, draft);
  const dirty = Object.keys(body).length > 0;
  const errors = Object.fromEntries(
    FIELDS.map(({ name, label }) => [name, limitError(name, label, draft[name])])
  ) as Record<BillingIdentityField, string | undefined>;

  const stepUp = (code: 'step_up_required' | 'mfa_required') =>
    new Promise<boolean>((resolve) =>
      // Enrolment also stamps the session, so both resolve the same way.
      openMfa(code === 'mfa_required' ? 'choose' : 'verify', {
        onVerified: () => resolve(true),
        onDismissed: () => resolve(false),
      })
    );

  const attempt = async (retried: boolean): Promise<void> => {
    try {
      await mutation.mutateAsync({ body, key: key.current! });
      key.current = null;
      toast({
        kind: 'success',
        title: 'Billing identity saved',
        // Saved here; the copy sent to the provider is best-effort (faas
        // handlers_billing_identity.go:74-78), so name where to confirm it.
        description:
          'It applies to invoices issued from now on. Your next invoice shows exactly what the provider received — check it there.',
      });
      onDone();
    } catch (err) {
      if (
        !retried &&
        err instanceof ApiError &&
        (err.code === 'step_up_required' || err.code === 'mfa_required')
      ) {
        if (await stepUp(err.code)) return attempt(true);
        setError(
          err.code === 'mfa_required'
            ? 'Set up two-factor authentication to change billing details.'
            : 'Verify with your authenticator to change billing details.'
        );
        return;
      }
      setError(errorMessage(err));
    }
  };

  const submit = async () => {
    if (!dirty || pending) return;
    setPending(true);
    setError(null);
    key.current ??= crypto.randomUUID();
    try {
      await attempt(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (validation.validate(errors, event.currentTarget)) void submit();
      }}
    >
      {FIELDS.map(({ name, label, multiline, hint }) => {
        const id = `${formId}-${name}`;
        const shown = validation.submitAttempted ? errors[name] : undefined;
        const describedBy = shown ? `${id}-error` : hint ? `${id}-hint` : undefined;
        const props = {
          id,
          name,
          value: draft[name],
          disabled: pending,
          onChange: (e: { target: { value: string } }) => {
            // A new value is a new logical write.
            key.current = null;
            setDraft((d) => ({ ...d, [name]: e.target.value }));
          },
          ...fieldErrorProps(shown, `${id}-error`),
          'aria-describedby': describedBy,
        };
        return (
          <div key={name} className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-xs font-medium">
              {label}
            </label>
            {multiline ? <Textarea rows={3} {...props} /> : <Input {...props} />}
            {shown ? (
              <FieldError id={`${id}-error`}>{shown}</FieldError>
            ) : (
              hint && (
                <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                  {hint}
                </p>
              )
            )}
          </div>
        );
      })}
      {error && (
        <p role="alert" className="text-sm text-[color:var(--status-critical)]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" busy={pending} disabled={!dirty}>
          Save
        </Button>
      </div>
    </form>
  );
}
