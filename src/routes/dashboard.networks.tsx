import { createFileRoute } from '@tanstack/react-router';
import { withCapability } from '@/components/dashboard/capability-gate';
import { PrivateNetworksBody } from '@/components/dashboard/networks/private-networks';
import { NETWORK_ID } from '@/lib/api/networks';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/networks')({
  // Gated like its nav item: a bookmarked URL explains itself when off.
  component: withCapability('private-networks', 'Private networks', NetworksPage),
  head: () => consoleHead('networks'),
  validateSearch: (search: Record<string, unknown>): { network?: string } =>
    typeof search.network === 'string' && NETWORK_ID.test(search.network)
      ? { network: search.network }
      : {},
});

function NetworksPage() {
  const { network } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PrivateNetworksBody
      selected={network}
      onSelect={(id) =>
        void navigate({ search: id ? { network: id } : {}, replace: true, resetScroll: false })
      }
    />
  );
}
