import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmProvider } from '@/components/ui/confirm';
import { useOnboardingWorkspace } from './use-onboarding-workspace';
import { useOnboardingInventory } from '@/lib/api/onboarding';
import { readOnboarding, writeOnboarding, type OnboardingOwner } from '@/lib/onboarding-draft';
import { OnboardingRecovery } from './onboarding-recovery';

/** Existing receipts remain inspectable when entry into the new flow is rolled back. */
export function OnboardingResume({ account, fallback }: { account: string; fallback: ReactNode }) {
  const workspace = useOnboardingWorkspace(account);
  if (!workspace.ready)
    return (
      <p role="status" className="p-8">
        Restoring your workspace…
      </p>
    );
  return (
    <ScopedResume
      key={JSON.stringify([account, workspace.org])}
      owner={{ account, workspace: workspace.org }}
      fallback={fallback}
    />
  );
}
function ScopedResume({ owner, fallback }: { owner: OnboardingOwner; fallback: ReactNode }) {
  const [record, setRecord] = useState(() => readOnboarding(owner));
  const inventory = useOnboardingInventory(owner);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  if (!record.draft?.app && record.draft?.phase !== 'unknown') return <>{fallback}</>;
  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <ConfirmProvider>
        <OnboardingRecovery
          owner={owner}
          draft={record.draft}
          apps={inventory.apps}
          inventoryUnavailable={inventory.pending || Boolean(inventory.error)}
          onRefresh={inventory.refresh}
          onChange={(draft) => {
            if (!active.current) return;
            const next = { ...record, draft };
            writeOnboarding(next);
            setRecord(next);
          }}
        />
      </ConfirmProvider>
    </main>
  );
}
