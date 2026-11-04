import { useEffect } from 'react';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { bindWorkspaceAccount } from '@/lib/workspace';

/** Onboarding has no dashboard switcher, which normally binds the workspace store. */
export function useOnboardingWorkspace(accountId: string) {
  useEffect(() => bindWorkspaceAccount(accountId), [accountId]);
  return useWorkspaceTarget(accountId);
}
