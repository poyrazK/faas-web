import { useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/store';
import { useBindRepoFor, useDeployFromRefFor } from './queries';

/**
 * Creating an app and deploying it from Git, in one place, so the New App
 * page and the canvas wizard cannot drift apart. Errors propagate unchanged:
 * the caller decides what a person sees.
 */
export function useCreateAndDeploy() {
  const { account } = useAuth();
  const { addWorkflow } = useData();
  const bindRepo = useBindRepoFor();
  const deployFromRef = useDeployFromRefFor();

  const createApp = useCallback(
    ({ name }: { name: string }) => addWorkflow({ name, memoryMb: 128, type: 'app' }),
    [addWorkflow]
  );

  const deployGit = useCallback(
    async ({ slug, repo, ref }: { slug: string; repo: string; ref: string }) => {
      const installationId = Number(account?.github_install_id);
      if (!Number.isSafeInteger(installationId) || installationId <= 0) {
        throw new Error('Connect GitHub before deploying from a repository.');
      }
      await bindRepo.mutateAsync({ slug, installationId, repo, branch: ref });
      return deployFromRef.mutateAsync({ slug, repo, ref, format: 'tarball' });
    },
    [account?.github_install_id, bindRepo, deployFromRef]
  );

  return { createApp, deployGit };
}
