import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import {
  IncidentDetail,
  StatusHeader,
  StatusNotFound,
  StatusUnavailable,
} from '@/components/status/status-page';
import { ApiError } from '@/lib/api/client';
import { usePublicStatusIncident } from '@/lib/api/status';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/status/incidents/$id')({
  component: IncidentRoute,
  head: () => ({
    meta: [
      ...pageHead({
        title: 'Status event',
        description: 'Gregale public incident and maintenance timeline.',
      }).meta,
      { name: 'robots', content: 'noindex, follow' },
    ],
  }),
});

function IncidentRoute() {
  const { id } = Route.useParams();
  const query = usePublicStatusIncident(id);
  useEffect(() => {
    if (query.data) document.title = `${query.data.title} · Gregale Status`;
  }, [query.data]);
  if (!query.data && query.error instanceof ApiError && [400, 404].includes(query.error.status)) {
    return <StatusNotFound />;
  }
  if (!query.data && query.isError) return <StatusUnavailable />;
  if (!query.data)
    return (
      <div className="status-shell">
        <StatusHeader />
        <main className="status-main status-unavailable" aria-busy="true">
          <p className="status-kicker">Status event</p>
          <h1>Loading timeline</h1>
          <p>
            This public page contains the event lifecycle, affected platform capabilities, and
            chronological operator updates.
          </p>
        </main>
      </div>
    );
  return <IncidentDetail event={query.data} />;
}
