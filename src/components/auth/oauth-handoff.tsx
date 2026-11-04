import { featureFlags } from '@/lib/feature-flags';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import {
  clearOAuthPending,
  hasOAuthPending,
  hasOnboarded,
  readOAuthReturnTo,
  useAuth,
} from '@/lib/auth';
import { ApiError, errorMessage } from '@/lib/api/errors';

/** Shared by both callback landing pages; failed reads never consume a handoff. */
export function OAuthHandoff() {
  const { user, account, loading, sessionError, apiReachable, refreshAccount } = useAuth();
  const navigate = useNavigate();
  const destination = useRef(readOAuthReturnTo());
  const [busy, setBusy] = useState(false);
  const [retryError, setRetryError] = useState<unknown>(null);
  const error = retryError ?? sessionError;
  const expired = error instanceof ApiError && error.isAuth;
  useEffect(() => {
    if (loading || busy || !user || !account || !apiReachable || !hasOAuthPending()) return;
    clearOAuthPending();
    if (destination.current) window.location.assign(destination.current);
    else
      void navigate({
        to: featureFlags.onboardingV2
          ? '/onboarding'
          : hasOnboarded()
            ? '/dashboard'
            : '/onboarding',
        replace: true,
      });
  }, [user, account, loading, busy, apiReachable, navigate]);

  if (loading || busy || (user && account && apiReachable && !error))
    return (
      <p role="status" aria-live="polite">
        Finishing sign-in…
      </p>
    );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Finish signing in</h1>
      <p role="alert" className="text-sm text-muted-foreground">
        {expired
          ? 'Your sign-in session could not be verified. Sign in again to continue.'
          : 'We could not verify your sign-in. Your destination is saved; try again when the API is available.'}
      </p>
      {Boolean(error) && !expired && (
        <p className="text-xs text-muted-foreground">{errorMessage(error)}</p>
      )}
      {!expired && (
        <Button
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setRetryError(null);
            try {
              await refreshAccount();
            } catch (cause) {
              setRetryError(cause);
            } finally {
              setBusy(false);
            }
          }}
        >
          Retry sign-in check
        </Button>
      )}
      <Button
        variant="outline"
        onClick={() => {
          clearOAuthPending();
          void navigate({ to: '/login', search: { next: destination.current }, replace: true });
        }}
      >
        Sign in again
      </Button>
    </div>
  );
}
