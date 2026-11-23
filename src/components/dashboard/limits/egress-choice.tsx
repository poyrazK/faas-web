import { useState } from 'react';
import { useMfa } from '@/components/auth/mfa-provider';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useSetEgressOverage } from '@/lib/api/limits';
import { formatMillicentRate } from '@/lib/money';

type StepUpCode = 'step_up_required' | 'mfa_required';

/**
 * Pay for egress beyond the allowance, or stop at it again. Changing it needs
 * the admin scope and a recent step-up (faas docs/billing.md "Egress
 * overage"), so a refused write opens the MFA modal once and replays under
 * the same idempotency key, as the company spend cap does.
 */
export function EgressChoice({
  org,
  enabled,
  includedGb,
  priceMillicentsPerGib,
  open: openProp,
  onOpenChange,
}: {
  org: string | null;
  enabled: boolean;
  includedGb?: number;
  priceMillicentsPerGib?: number;
  /** Controlled by the page when the status strip opens the same choice. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const mutation = useSetEgressOverage(org);
  const { openMfa } = useMfa();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const allowance = includedGb != null ? `${includedGb} GiB` : 'the allowance';
  const price =
    priceMillicentsPerGib != null ? formatMillicentRate(priceMillicentsPerGib) : 'the egress rate';

  const stepUp = (code: StepUpCode) =>
    new Promise<boolean>((resolve) =>
      openMfa(code === 'mfa_required' ? 'choose' : 'verify', {
        onVerified: () => resolve(true),
        onDismissed: () => resolve(false),
      })
    );

  const write = async (retried = false): Promise<void> => {
    try {
      await mutation.mutateAsync({ enabled: !enabled, key });
    } catch (err) {
      if (
        !retried &&
        err instanceof ApiError &&
        (err.code === 'step_up_required' || err.code === 'mfa_required')
      ) {
        if (await stepUp(err.code)) return write(true);
        throw new Error('Two-factor verification is needed to change this.', { cause: err });
      }
      throw err;
    }
  };

  const confirm = async () => {
    setError(null);
    try {
      await write();
      setOpen(false);
      setKey(crypto.randomUUID());
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err) : (err as Error).message);
    }
  };

  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        {enabled ? 'Stop at allowance' : 'Pay beyond'}
      </Button>
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title={enabled ? 'Stop at the egress allowance?' : 'Pay for egress beyond the allowance?'}
          width="max-w-md"
        >
          <div className="flex flex-col gap-4 text-sm">
            <p>
              {enabled
                ? `Apps will stop again when egress reaches ${allowance}. Egress already sent stays billed.`
                : `Egress above ${allowance} is billed at ${price} per GiB and counts toward your spend cap.`}
            </p>
            {error && (
              <p role="alert" className="text-status-critical">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void confirm()} disabled={mutation.isPending}>
                {enabled ? 'Turn off' : 'Turn on'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
