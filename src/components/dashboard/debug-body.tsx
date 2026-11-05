import { useCapabilityAccess } from '@/lib/api/capabilities';
import type { CapabilityAccess } from '@/lib/capability-state';
import { MaturityLabel } from './maturity-label';
import { InlinePhase, Panel } from './primitives';
import { SegmentedControl } from './tabs';
import { DebugRequests } from './debug-requests';
import { DebugRegressions } from './debug-regressions';
import { DebugCompare } from './debug-compare';
import { DebugDependencies } from './debug-dependencies';
import { DebugCoverage, DebugRunningView } from './debug-signals';
import { DebugRequestEvidence } from './debug-request-evidence';
import { DebugStatusPanel } from './debug-status';
import {
  DEBUG_VIEWS,
  DEBUG_VIEW_LABELS,
  PREVIEW_DEBUG_VIEWS,
  WINDOWS,
  type DebugSelection,
  type DebugView,
} from './debug-search';

/*
 * One investigation, hosted by either the global debugger or an app tab.
 *
 * Two capabilities own the routes underneath (faas pkg/productcap/catalog.json,
 * enforced by apid's capgate): the beta `debug` family — regressions and their
 * triage, dependencies, coverage, running — which every account has, and the
 * `production-debugger` preview — status, the request list with its evidence,
 * export and replay, and compare. Preview views mount, and so read, only once
 * the registry says the preview is on; otherwise the beta views stand alone.
 */

const PREVIEW_OFF: Record<Exclude<CapabilityAccess, 'on' | 'loading'>, string> = {
  off: 'Request evidence, status, export, replay and compare are the Production debugger preview, which is not enabled for this account.',
  'plan-not-entitled':
    'Request evidence, status, export, replay and compare are the Production debugger preview, which your plan does not include.',
  'runtime-unavailable': 'The Production debugger preview is unavailable on this installation.',
  'registry-error': 'Whether the Production debugger preview is available could not be checked.',
};

export function DebugBody({ slug, search, onSelect }: { slug: string } & DebugSelection) {
  const preview = useCapabilityAccess('production-debugger');
  const { capability: debug } = useCapabilityAccess('debug');
  const previewOn = preview.access === 'on';
  const settled = preview.access !== 'loading';
  const views = DEBUG_VIEWS.filter((id) => previewOn || !PREVIEW_DEBUG_VIEWS.has(id));
  const view: DebugView | undefined =
    search.debugView ?? (settled ? (previewOn ? 'requests' : 'regressions') : undefined);
  const lookback = search.debugWindow ?? '24h';
  const openRequest = previewOn ? (request: string) => onSelect({ request }) : undefined;

  return (
    <Panel title="Debugger" actions={<MaturityLabel capability={debug} />}>
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        {
          'Investigate gateway requests with recorded details. Routes are templates, not expanded URLs.'
        }
      </p>

      <div className="flex flex-col gap-4">
        {previewOn && (
          <DebugStatusPanel
            key={slug}
            slug={slug}
            since={search.debugWindow ?? '1h'}
            onOpenRequest={(request) => onSelect({ request })}
          />
        )}
        <SegmentedControl
          label="Debugger views"
          value={view ?? 'regressions'}
          options={views.map((id) => ({ key: id, label: DEBUG_VIEW_LABELS[id] }))}
          onChange={(id) => onSelect({ debugView: id, request: undefined })}
        />
        {settled && !previewOn && (
          <p
            role="status"
            className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground"
          >
            {PREVIEW_OFF[preview.access as keyof typeof PREVIEW_OFF]}
            {preview.access === 'off' && (
              <a className="text-brand underline" href="/dashboard/settings?section=previews">
                See previews you can join
              </a>
            )}
            {preview.access === 'plan-not-entitled' && (
              <a className="text-brand underline" href="/dashboard/plans">
                View plans
              </a>
            )}
            {preview.access === 'registry-error' && (
              <button type="button" className="text-brand underline" onClick={preview.refresh}>
                Retry
              </button>
            )}
          </p>
        )}
        {!view || (PREVIEW_DEBUG_VIEWS.has(view) && !settled) ? (
          <InlinePhase phase="loading" loadingMessage="Checking availability…" />
        ) : PREVIEW_DEBUG_VIEWS.has(view) && !previewOn ? null : (
          <>
            {view === 'requests' && (
              <DebugRequests key={slug} slug={slug} search={search} onSelect={onSelect} />
            )}
            {view === 'regressions' && (
              <DebugRegressions
                key={slug}
                slug={slug}
                search={search}
                onSelect={onSelect}
                preview={previewOn}
              />
            )}
            {(view === 'dependencies' || view === 'coverage' || view === 'running') && (
              <label className="flex items-center gap-2 self-start text-xs text-muted-foreground">
                Window
                <select
                  aria-label="Window"
                  value={lookback}
                  onChange={(e) => onSelect({ debugWindow: e.target.value as typeof lookback })}
                  className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand/50"
                >
                  {WINDOWS.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {view === 'dependencies' && (
              <DebugDependencies
                key={slug}
                slug={slug}
                since={lookback}
                onOpenRequest={openRequest}
              />
            )}
            {view === 'coverage' && <DebugCoverage key={slug} slug={slug} since={lookback} />}
            {view === 'running' && <DebugRunningView key={slug} slug={slug} since={lookback} />}
            {view === 'compare' && (
              <DebugCompare key={slug} slug={slug} search={search} onSelect={onSelect} />
            )}
          </>
        )}
        {previewOn && search.request && (
          <DebugRequestEvidence
            key={`${slug}:${search.request}`}
            slug={slug}
            // One dialog at a time: the evidence steps aside while a wake is
            // open and returns when the drawer closes, since `request` stays.
            reqId={search.wake ? null : search.request}
            onOpenWake={(wake) => onSelect({ wake })}
            onClose={() => onSelect({ request: undefined })}
            onRegression={(regression) =>
              onSelect({ debugView: 'regressions', regression, request: undefined })
            }
            onCompare={(debugSource, debugMirror) =>
              onSelect({ debugView: 'compare', debugSource, debugMirror, request: undefined })
            }
          />
        )}
      </div>
    </Panel>
  );
}
