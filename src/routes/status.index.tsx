import { createFileRoute } from '@tanstack/react-router';
import { StatusHeader, StatusOverview, StatusUnavailable } from '@/components/status/status-page';
import { usePublicStatus } from '@/lib/api/status';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/status/')({
  component: StatusRoute,
  head: () =>
    pageHead({
      title: 'Status',
      description:
        'Current Gregale platform status, service indicators, maintenance, and incident history.',
    }),
});

function StatusRoute() {
  const query = usePublicStatus();
  if (!query.data && query.isError) return <StatusUnavailable />;
  if (!query.data) return <StatusLoading />;
  return (
    <StatusOverview
      snapshot={query.data}
      updatesDelayed={query.isError || query.data.data_status !== 'fresh'}
    />
  );
}

function StatusLoading() {
  const capabilities = [
    'API & Console',
    'Deployments',
    'App execution',
    'Networking',
    'Observability',
  ];
  return (
    <div className="status-shell">
      <StatusHeader />
      <main className="status-main status-unavailable" aria-busy="true">
        <p className="status-kicker">Current platform status</p>
        <h1>Checking current status</h1>
        <p>Loading capability health, recent incidents, and the latest service indicators.</p>
        <section className="status-section" aria-labelledby="loading-capabilities">
          <div className="status-section-heading">
            <p>Current scope</p>
            <h2 id="loading-capabilities">Platform capabilities</h2>
          </div>
          <div className="status-ledger">
            {capabilities.map((capability) => (
              <article className="status-capability" key={capability}>
                <h3>{capability}</h3>
                <p className="status-empty">Status data is loading.</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
