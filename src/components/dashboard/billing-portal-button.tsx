import { useEffect, useRef, useState } from 'react';
import { OpenNewWindow } from 'iconoir-react';
import { useAuthenticatorStepUp } from '@/components/auth/use-authenticator-step-up';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useBillingPortal } from '@/lib/api/queries';
import { ApiError } from '@/lib/api/errors';
import { goToExternal } from '@/lib/external-navigation';

export function BillingPortalButton() {
  const { toast } = useToast();
  const stepUp = useAuthenticatorStepUp();
  const portal = useBillingPortal();
  const [opening, setOpening] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const openPortal = async () => {
    setOpening(true);
    try {
      let result;
      try {
        result = await portal.mutateAsync();
      } catch (error) {
        if (!mounted.current) return;
        if (!(error instanceof ApiError && error.code === 'step_up_required')) throw error;
        if (!(await stepUp('Confirm it’s you to open the billing portal.'))) return;
        if (!mounted.current) return;
        result = await portal.mutateAsync();
      }

      if (!mounted.current) return;
      if (result.url) {
        goToExternal(result.url);
      } else {
        toast({
          kind: 'info',
          title: 'Billing portal unavailable',
          description: 'There is no billing portal available for this account right now.',
        });
      }
    } catch (error) {
      if (mounted.current) {
        toast({ kind: 'error', title: 'Could not open the billing portal', error });
      }
    } finally {
      if (mounted.current) setOpening(false);
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      busy={opening}
      onClick={() => void openPortal()}
    >
      <OpenNewWindow className="size-3.5" aria-hidden="true" />
      Billing portal
    </Button>
  );
}
