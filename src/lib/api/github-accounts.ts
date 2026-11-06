import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';

const key = (accountID?: string) => ['github', 'connections', accountID] as const;
export function useGitHubAccounts() {
  const { account } = useAuth();
  return useQuery({
    queryKey: key(account?.id),
    queryFn: ({ signal }) => unwrap(api.GET('/v1/install/connections', { signal })),
    enabled: Boolean(account?.id),
    retry: retryPolicy,
  });
}
async function token(qc: QueryClient, accountID?: string) {
  await qc.cancelQueries({ queryKey: key(accountID) });
  const result = await unwrap(api.GET('/v1/install/connections'));
  qc.setQueryData(key(accountID), result);
  return result.csrf_token;
}
export function useVerifyGitHubAccount() {
  const qc = useQueryClient();
  const { account } = useAuth();
  return useMutation({
    mutationFn: async (installationID: number) => {
      const csrf_token = await token(qc, account?.id);
      return unwrap(
        api.POST('/v1/install/connections/{installationID}/verify', {
          params: { path: { installationID } },
          body: { csrf_token },
        })
      );
    },
  });
}
export function useDisconnectGitHubAccount() {
  const qc = useQueryClient();
  const { account, refreshAccount } = useAuth();
  return useMutation({
    mutationFn: async (installationID: number) => {
      const csrf_token = await token(qc, account?.id);
      await unwrap(
        api.DELETE('/v1/install/connections/{installationID}', {
          params: { path: { installationID } },
          body: { csrf_token },
        })
      );
    },
    onSuccess: async () => {
      await qc.invalidateQueries();
      await refreshAccount().catch(() => undefined);
    },
  });
}
