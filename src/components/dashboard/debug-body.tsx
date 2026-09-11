import { Button } from '@/components/ui/button';
import { Panel } from './primitives';
import { DebugRequests } from './debug-requests';
import { DebugRegressions } from './debug-regressions';
import { DebugCompare } from './debug-compare';
import { DebugRequestEvidence } from './debug-request-evidence';
import { DEBUG_VIEWS, type DebugSelection } from './debug-search';

/** One investigation, hosted by either the global debugger or an app tab. */
export function DebugBody({ slug, search, onSelect }: { slug: string } & DebugSelection) {
  const view = search.debugView ?? 'requests';
  return (
    <Panel
      title="Debugger"
      description="Investigate gateway requests with recorded evidence. Routes are templates, not expanded URLs."
      actions={
        <nav aria-label="Debugger views" className="flex gap-2">
          {DEBUG_VIEWS.map((id) => (
            <Button
              key={id}
              size="xs"
              variant={view === id ? 'default' : 'secondary'}
              aria-pressed={view === id}
              onClick={() => onSelect({ debugView: id, request: undefined })}
            >
              {id[0].toUpperCase() + id.slice(1)}
            </Button>
          ))}
        </nav>
      }
    >
      {view === 'requests' && (
        <DebugRequests key={slug} slug={slug} search={search} onSelect={onSelect} />
      )}
      {view === 'regressions' && (
        <DebugRegressions key={slug} slug={slug} search={search} onSelect={onSelect} />
      )}
      {view === 'compare' && (
        <DebugCompare key={slug} slug={slug} search={search} onSelect={onSelect} />
      )}
      {search.request && (
        <DebugRequestEvidence
          key={`${slug}:${search.request}`}
          slug={slug}
          reqId={search.request}
          onClose={() => onSelect({ request: undefined })}
          onRegression={(regression) =>
            onSelect({ debugView: 'regressions', regression, request: undefined })
          }
        />
      )}
    </Panel>
  );
}
