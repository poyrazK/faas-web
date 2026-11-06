import { useMfa } from '@/components/auth/mfa-provider';
import { useMfaAction } from '@/components/auth/use-mfa-action';
import { Button } from '@/components/ui/button';
import { FIELD, FieldError, fieldErrorProps, useFormValidation } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useOrgOverageCap, useSetOrgOverageCap } from '@/lib/api/org-billing';
import { useOverageCap, useSetOverageCap } from '@/lib/api/queries';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { formatCents } from '@/lib/money';
import { useId, useState } from 'react';
import { orgBillingMessage } from './org-billing';
import { InlinePhase, Panel, queryPhase } from './primitives';

// A $0 cap counts as reached at once, so workloads stop even inside the
// included allowance (faas docs/billing.md:33-35, pkg/sched/overage.go:207).
const DESCRIPTION =
  'Limit monthly overage spending. When the cap is reached, new wakes are refused and running apps park. A $0 cap pauses every workload, even within the allowance; clear the cap to remove the ceiling.';

/**
 * An organization that owns its resources is billed and capped apart from its
 * members: its apps park at its cap, not at the cap of the member who created
 * them (ADR-20261030093512, faas eca7074).
 */
const orgDescription = (label: string) =>
  `Limit ${label}'s monthly overage. ${label}'s apps stop at this cap, not at any member's own: new wakes are refused and running apps park until the cap is raised or the month ends. A $0 cap pauses them all. Only its owner changes it.`;

function capLabel(cents: number | null): string {
  if (cents === null) return 'No cap set';
  const money = formatCents(cents);
  return cents === 0 ? `${money} · Workloads paused` : money;
}

/**
 * The spend cap of the active workspace, inline on Plans and compact on Usage:
 * the signed-in account's own, or in a company workspace the organization's
 * (`/v1/orgs/{slug}/overage-cap`). Nothing is read until the workspace is
 * known, so a chosen company is never shown the personal cap.
 */
export function SpendCap({ compact = false }: { compact?: boolean }) {
  const { org, label: workspace, ready: bound } = useWorkspaceTarget();
  const personal = useOverageCap({ enabled: bound && !org });
  const company = useOrgOverageCap(org ?? '', { enabled: bound });
  const query = org ? company : personal;
  const [open, setOpen] = useState(false);
  if (!bound) return null;

  const description = org ? orgDescription(workspace) : DESCRIPTION;
  const ready = !query.isPending && !query.error && query.data !== undefined;
  // A company refuses a member without the right role; say who can see it.
  const refused =
    org && query.error instanceof ApiError && query.error.code === 'org_role_forbidden';
  const phase = refused ? (
    <p role="status" className="text-sm text-muted-foreground">
      {orgBillingMessage(query.error, workspace, 'spend cap')}
    </p>
  ) : (
    <InlinePhase
      phase={queryPhase({ error: query.error, loading: query.isPending })}
      error={query.error}
      loadingMessage="Reading spend cap…"
      onRetry={() => void query.refetch()}
    />
  );
  const label = ready ? capLabel(query.data!.overage_cap_cents) : '';
  const editor = ready ? (
    <SpendCapEditor
      initialCents={query.data!.overage_cap_cents}
      org={org}
      workspaceLabel={workspace}
    />
  ) : (
    phase
  );

  if (!compact)
    return (
      <Panel title={org ? `${workspace}'s spend cap` : 'Spend cap'} help={description}>
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
          description={description}
          width="max-w-lg"
        >
          <div className="max-h-[calc(100dvh-15rem)] overflow-y-auto p-1">{editor}</div>
        </Modal>
      )}
    </>
  );
}

/**
 * Edits one workspace's cap: the signed-in account's, or with `org` the
 * organization's. Each subject has its own editor, so the personal one never
 * holds the company write and the company one never holds the personal write.
 */
export function SpendCapEditor({
  initialCents,
  org = null,
  workspaceLabel = 'Personal',
}: {
  initialCents: number | null;
  org?: string | null;
  workspaceLabel?: string;
}) {
  return org ? (
    <OrgCapEditor initialCents={initialCents} org={org} label={workspaceLabel} />
  ) : (
    <PersonalCapEditor initialCents={initialCents} />
  );
}

function PersonalCapEditor({ initialCents }: { initialCents: number | null }) {
  const mutation = useSetOverageCap();
  const withMfa = useMfaAction();
  return (
    <CapForm
      initialCents={initialCents}
      pending={mutation.isPending}
      subject="Spend cap"
      write={async (value) =>
        void (await withMfa(() => mutation.mutateAsync(value), 'Verify to change your spend cap.'))
      }
      describe={errorMessage}
    />
  );
}

/**
 * A company write needs the owner and a step-up from the last five minutes
 * (faas org_billing_routes.go:16-25), so it asks for one once and replays the
 * same write under the same idempotency key.
 */
function OrgCapEditor({
  initialCents,
  org,
  label,
}: {
  initialCents: number | null;
  org: string;
  label: string;
}) {
  const mutation = useSetOrgOverageCap(org);
  const { openMfa } = useMfa();

  const stepUp = (_code: StepUpCode) =>
    new Promise<boolean>((resolve) =>
      // Enrolment also stamps the session, so both resolve the same way.
      openMfa('choose', {
        onVerified: () => resolve(true),
        onDismissed: () => resolve(false),
      })
    );

  const write = async (value: number | null, key: string, retried = false): Promise<void> => {
    try {
      await mutation.mutateAsync({ capCents: value, key });
    } catch (err) {
      if (
        !retried &&
        err instanceof ApiError &&
        (err.code === 'step_up_required' || err.code === 'mfa_required')
      ) {
        if (await stepUp(err.code)) return write(value, key, true);
        throw new StepUpMissed(err.code);
      }
      throw err;
    }
  };

  return (
    <CapForm
      initialCents={initialCents}
      pending={mutation.isPending}
      subject={`${label}'s spend cap`}
      // One key per logical write, kept across the step-up retry.
      write={(value) => write(value, crypto.randomUUID())}
      describe={(err) => orgFailureMessage(err, label)}
    />
  );
}

function CapForm({
  initialCents,
  pending,
  subject,
  write,
  describe,
}: {
  initialCents: number | null;
  pending: boolean;
  subject: string;
  write: (value: number | null) => Promise<void>;
  describe: (err: unknown) => string;
}) {
  const { toast } = useToast();
  const [failure, setFailure] = useState<string | null>(null);
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
    if (pending) return;
    setFailure(null);
    try {
      await write(value);
      setDraft(null);
      validation.resetValidation();
      toast({
        kind: 'success',
        title: value === null ? `${subject} cleared` : `${subject} set to ${formatCents(value)}`,
      });
    } catch (err) {
      const message = describe(err);
      setFailure(message);
      toast({
        kind: 'error',
        title: value === null ? 'Could not clear cap' : 'Could not set cap',
        description: message,
        ...(err instanceof StepUpMissed ? {} : { error: err }),
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
        <span className="text-xs font-medium">Cap (USD)</span>
        <input
          name="euros"
          type="number"
          min={0}
          step="0.01"
          value={euros}
          disabled={pending}
          onChange={(e) => setDraft(e.target.value)}
          {...fieldErrorProps(shownError, errorId)}
          placeholder="10.00"
          className={`${FIELD} w-36 tabular-nums`}
        />
        {shownError && <FieldError id={errorId}>{shownError}</FieldError>}
      </label>
      <Button type="submit" size="sm" busy={pending} aria-label="Set cap">
        Set cap
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => void save(null)}
      >
        Clear cap
      </Button>
      {failure && (
        <p role="alert" className="w-full text-sm text-[color:var(--status-critical)]">
          {failure}
        </p>
      )}
    </form>
  );
}

type StepUpCode = 'step_up_required' | 'mfa_required';

/** The person closed the step-up prompt; nothing was written. */
class StepUpMissed extends Error {
  constructor(readonly code: StepUpCode) {
    super(code);
  }
}

/**
 * A company write refused for the member's role, a missing step-up or an
 * unverified email names the organization; anything else is the API's own
 * sentence.
 */
function orgFailureMessage(err: unknown, label: string): string {
  if (err instanceof StepUpMissed)
    return err.code === 'mfa_required'
      ? `Set up two-factor authentication to change ${label}'s spend cap.`
      : `Verify with your authenticator to change ${label}'s spend cap.`;
  if (err instanceof ApiError) {
    // Owner only (faas pkg/authz/authorize.go:120, OrgActionChangePlan).
    if (err.code === 'org_role_forbidden') return `Only ${label}'s owner can change its spend cap.`;
    if (err.code === 'email_verification_required')
      return `Verify your email address before changing ${label}'s spend cap.`;
  }
  return errorMessage(err);
}
