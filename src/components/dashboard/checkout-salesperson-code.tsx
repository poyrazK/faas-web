import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { useCheckoutReferral } from '@/lib/api/referrals';

export function CheckoutSalespersonCode({
  accountId,
  value,
  error,
  onChange,
}: {
  accountId: string;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const referral = useCheckoutReferral(accountId);

  return (
    <div className="flex flex-col gap-2">
      {referral.isLoading ? (
        <p className="text-xs text-muted-foreground">Checking salesperson code availability…</p>
      ) : referral.isError ? (
        <div className="text-xs text-muted-foreground">
          <p>Could not check salesperson codes. You can still continue without one.</p>
          <Button size="sm" variant="ghost" onClick={() => void referral.refetch()}>
            Check again
          </Button>
        </div>
      ) : referral.data?.eligible ? (
        <>
          <label htmlFor={id} className="text-sm font-medium">
            Salesperson code (optional)
          </label>
          <input
            id={id}
            name="salesperson_code"
            value={value}
            onChange={(event) => onChange(event.target.value.trim().toUpperCase())}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={6}
            placeholder="POJU43"
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
          />
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            The code is saved for your first paid purchase, including if you retry checkout.
          </p>
        </>
      ) : referral.data?.reason === 'already_attributed' ? (
        <p className="text-xs text-muted-foreground">Your existing referral will be kept.</p>
      ) : null}
      {error && (
        <div id={`${id}-error`} role="alert" className="text-sm text-destructive">
          <p>{error}</p>
          <Button size="sm" variant="ghost" onClick={() => onChange('')}>
            Clear code
          </Button>
        </div>
      )}
    </div>
  );
}
