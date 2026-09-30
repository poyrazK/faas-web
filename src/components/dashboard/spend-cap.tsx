import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FIELD, FieldError, fieldErrorProps, useFormValidation } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { useOverageCap, useSetOverageCap } from '@/lib/api/queries';
import { errorMessage } from '@/lib/api/errors';
import { InlinePhase, Panel, queryPhase } from './primitives';

const DESCRIPTION =
  'Limit monthly overage spending. When the cap is reached, new wakes beyond your allowance are refused. Set €0 to disallow overage, or clear the cap to remove the ceiling.';

function capLabel(cents: number | null): string {
  if (cents === null) return 'No cap set';
  const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(
    cents / 100
  );
  return cents === 0 ? `${money} · No overage allowed` : money;
}

/** The same account setting and editor, inline on Plans and compact on Usage. */
export function SpendCap({ compact = false }: { compact?: boolean }) {
  const query = useOverageCap();
  const [open, setOpen] = useState(false);
  const ready = !query.isPending && !query.error && query.data !== undefined;
  const phase = (
    <InlinePhase
      phase={queryPhase({ error: query.error, loading: query.isPending })}
      error={query.error}
      loadingMessage="Reading spend cap…"
      onRetry={() => void query.refetch()}
    />
  );
  const label = ready ? capLabel(query.data!.overage_cap_cents) : '';
  const editor = ready ? <SpendCapEditor initialCents={query.data!.overage_cap_cents} /> : phase;

  if (!compact)
    return (
      <Panel title="Spend cap" description={DESCRIPTION}>
        {ready && (
          <p className="mb-4 text-sm text-muted-foreground">
            Monthly overage cap: <span className="font-medium text-foreground">{label}</span>
          </p>
        )}
        {editor}
      </Panel>
    );

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>Monthly overage cap:</span>
        {ready ? (
          <>
            <span className="font-medium text-foreground">{label}</span>
            <Button
              size="xs"
              variant="ghost"
              aria-label="Manage spend cap"
              aria-haspopup="dialog"
              onClick={() => setOpen(true)}
            >
              Manage
            </Button>
          </>
        ) : (
          phase
        )}
      </div>
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title="Spend cap"
          description={DESCRIPTION}
          width="max-w-lg"
        >
          <div className="max-h-[calc(100dvh-15rem)] overflow-y-auto p-1">{editor}</div>
        </Modal>
      )}
    </>
  );
}

function SpendCapEditor({ initialCents }: { initialCents: number | null }) {
  const { toast } = useToast();
  const mutation = useSetOverageCap();
  // Follow fresh readback until the user starts editing; refetches must not
  // replace an unsaved draft or leave an untouched input on an obsolete cap.
  const [draft, setDraft] = useState<string | null>(null);
  const euros = draft ?? (initialCents === null ? '' : (initialCents / 100).toFixed(2));
  const validation = useFormValidation<'euros'>();
  const errorId = useId();
  const cents = Math.round(Number(euros) * 100);
  const amountOk = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(euros) && Number.isSafeInteger(cents);
  const amountError = amountOk
    ? undefined
    : 'Enter zero or a positive amount with no more than two decimal places.';
  const shownError = validation.submitAttempted ? amountError : undefined;
  const save = async (value: number | null) => {
    if (mutation.isPending) return;
    try {
      await mutation.mutateAsync(value);
      setDraft(null);
      validation.resetValidation();
      toast({
        kind: 'success',
        title:
          value === null ? 'Spend cap cleared' : `Spend cap set to €${(value / 100).toFixed(2)}`,
      });
    } catch (err) {
      toast({
        kind: 'error',
        title: value === null ? 'Could not clear cap' : 'Could not set cap',
        description: errorMessage(err),
      });
    }
  };
  return (
    <form
      noValidate
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (validation.validate({ euros: amountError }, event.currentTarget)) void save(cents);
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Cap (EUR)</span>
        <input
          name="euros"
          type="number"
          min={0}
          step="0.01"
          value={euros}
          disabled={mutation.isPending}
          onChange={(e) => setDraft(e.target.value)}
          {...fieldErrorProps(shownError, errorId)}
          placeholder="10.00"
          className={`${FIELD} w-36 tabular-nums`}
        />
        {shownError && <FieldError id={errorId}>{shownError}</FieldError>}
      </label>
      <Button type="submit" size="sm" busy={mutation.isPending} aria-label="Set cap">
        Set cap
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={mutation.isPending}
        onClick={() => void save(null)}
      >
        Clear cap
      </Button>
      {mutation.error && (
        <p role="alert" className="w-full text-sm text-[color:var(--status-critical)]">
          {errorMessage(mutation.error)}
        </p>
      )}
    </form>
  );
}
