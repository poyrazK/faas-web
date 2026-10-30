import { useId, useState, type ReactNode } from 'react';
import { Check } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { CopyIconButton } from '@/components/ui/copy-button';
import { EmptyState, InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { useTemplates, type TemplateView } from '@/lib/api/queries';
import { cn } from '@/lib/utils';

/**
 * The starter catalog, from `GET /v1/templates` — the same 13-entry list the
 * CLI's `init --template` and `deploy --template` validate against, so a name
 * here is a name the CLI accepts.
 *
 * A starter prefills the new-app wizard with the template's name; the scaffold
 * itself is written by the CLI (`gregale init --template NAME`), which the
 * wizard shows once the app exists. No fake one-click deploy pretending the
 * CLI step does not exist, and no hand-kept copy of the catalog to drift.
 *
 * Each starter is one choice (a pressed button): its runtime, name and line of
 * description. The CLI step is shown once, for the chosen starter, in a bar
 * that stays in view with the caller's `action` (the wizard's Continue).
 */

const CATEGORY: Record<TemplateView['category'], { label: string }> = {
  hello: { label: 'Hello' },
  function: { label: 'Functions' },
  'stateless-contract': { label: 'Stateless services' },
  ai: { label: 'AI' },
};

const CATEGORY_ORDER: TemplateView['category'][] = [
  'hello',
  'function',
  'stateless-contract',
  'ai',
];

// The runtime a starter is written in, from its name's suffix. The API does
// not report it; every runtime-specific starter in the catalog ends in one.
const RUNTIME: { suffix: string; label: string; mark: string }[] = [
  { suffix: '-node', label: 'Node.js', mark: 'JS' },
  { suffix: '-python', label: 'Python', mark: 'PY' },
  { suffix: '-go', label: 'Go', mark: 'GO' },
];
function look(t: TemplateView) {
  const runtime = RUNTIME.find((r) => t.name.endsWith(r.suffix));
  return {
    runtime: runtime?.label,
    mark:
      runtime?.mark ??
      t.name
        .replace(/[^a-z0-9]/gi, '')
        .slice(0, 2)
        .toUpperCase(),
  };
}

export function TemplateCatalog({
  selected,
  onSelect,
  onChooseEmpty,
  action,
}: {
  selected?: string;
  onSelect: (slug: string) => void;
  onChooseEmpty?: () => void;
  /** Shown beside the chosen starter's next step: the way on. */
  action?: ReactNode;
}) {
  const uid = useId();
  const templates = useTemplates();
  const list = templates.data ?? [];
  const phase = queryPhase({
    error: templates.error,
    loading: templates.isPending,
    isEmpty: list.length === 0,
  });
  const [filter, setFilter] = useState<TemplateView['category'] | 'all'>('all');
  const categories = CATEGORY_ORDER.filter((c) => list.some((t) => t.category === c));
  const shown = filter === 'all' ? categories : categories.filter((c) => c === filter);
  // The bar names the chosen starter; with an `action`, the caller vouches for
  // a selection the list may not hold (a template link outside the catalog).
  const chosen = list.find((t) => t.name === selected)?.name ?? (action ? selected : undefined);

  // One starter: a row in its category's list, laid out like New app's
  // source list (mark, name, one line), with a check once it is chosen.
  const row = (t: TemplateView) => {
    const { runtime, mark } = look(t);
    const on = selected === t.name;
    return (
      <button
        key={t.name}
        type="button"
        onClick={() => onSelect(t.name)}
        aria-pressed={on}
        aria-labelledby={`${uid}-${t.name}`}
        aria-describedby={`${uid}-${t.name}-desc`}
        className={cn(
          // Rows round with the list, so hover, selection and focus follow its corners.
          'flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors first:rounded-t-[11px] last:rounded-b-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand',
          on ? 'bg-accent/50' : 'hover:bg-accent/40'
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md font-mono text-[11px] font-semibold transition-colors',
            on ? 'bg-brand/15 text-brand' : 'bg-muted text-muted-foreground'
          )}
        >
          {mark}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span id={`${uid}-${t.name}`} className="truncate font-mono text-sm font-medium">
              {t.name}
            </span>
            {runtime && <span className="shrink-0 text-xs text-muted-foreground">{runtime}</span>}
          </span>
          <span id={`${uid}-${t.name}-desc`} className="text-[13px] text-muted-foreground">
            {t.description}
          </span>
        </span>
        <Check
          aria-hidden
          className={cn('h-4 w-4 shrink-0 text-brand', on ? 'opacity-100' : 'opacity-0')}
        />
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">Pick a starter to prefill your app.</p>
      {phase === 'empty' ? (
        <EmptyState
          message="The catalog is empty on this deployment."
          action={
            onChooseEmpty && (
              <Button size="sm" onClick={onChooseEmpty}>
                Continue with an empty app
              </Button>
            )
          }
        />
      ) : phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={templates.error}
          loadingMessage="Loading the catalog…"
          onRetry={() => void templates.refetch()}
        />
      ) : (
        <>
          <div
            role="group"
            aria-label="Filter starters"
            className="flex flex-wrap items-center gap-1.5"
          >
            {(['all', ...categories] as const).map((c) => {
              const count = c === 'all' ? list.length : list.filter((t) => t.category === c).length;
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={filter === c}
                  onClick={() => setFilter(c)}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                    filter === c
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  {c === 'all' ? 'All' : CATEGORY[c].label}
                  <span className="font-mono text-[10.5px] opacity-70">{count}</span>
                </button>
              );
            })}
          </div>

          {shown.map((category) => (
            <section
              key={category}
              aria-labelledby={`${uid}-cat-${category}`}
              className="flex flex-col gap-3"
            >
              <h2
                id={`${uid}-cat-${category}`}
                className="text-sm font-medium text-muted-foreground"
              >
                {CATEGORY[category].label}
              </h2>
              <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
                {list.filter((t) => t.category === category).map(row)}
              </div>
            </section>
          ))}
        </>
      )}
      {chosen && (
        // The next step for the chosen starter, kept in view at the foot
        // of the screen with the way on.
        <section
          aria-label="Chosen starter"
          className="sticky bottom-4 z-10 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-border bg-card p-3 shadow-lg"
        >
          <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">
              <span className="font-mono font-semibold text-foreground">{chosen}</span>. Create the
              app, then write the scaffold:
            </p>
            <div className="flex min-w-0 items-center gap-1 rounded-md bg-muted py-1 pl-3 pr-1">
              <span
                aria-hidden="true"
                className="select-none font-mono text-xs text-muted-foreground"
              >
                $
              </span>
              <code className="min-w-0 overflow-x-auto whitespace-nowrap font-mono text-xs text-foreground">
                gregale init --template {chosen}
              </code>
              <CopyIconButton
                text={`gregale init --template ${chosen}`}
                label={`gregale init --template ${chosen}`}
                className="ml-auto"
              />
            </div>
          </div>
          {action}
        </section>
      )}
    </div>
  );
}
