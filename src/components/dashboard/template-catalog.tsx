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

const CATEGORY: Record<TemplateView['category'], { label: string; blurb: string }> = {
  hello: { label: 'Hello', blurb: 'First-touch smoke tests: the smallest server per runtime.' },
  function: { label: 'Functions', blurb: 'The function contract per runtime, ready to extend.' },
  'stateless-contract': {
    label: 'Stateless services',
    blurb: 'Workers, receivers and APIs that keep their state in the platform, not the instance.',
  },
  ai: { label: 'AI', blurb: 'Model-backed apps with the platform doing the scaling.' },
};

const CATEGORY_ORDER: TemplateView['category'][] = [
  'hello',
  'function',
  'stateless-contract',
  'ai',
];

// The runtime a starter is written in, from its name's suffix. The API does
// not report it; every runtime-specific starter in the catalog ends in one.
const RUNTIME: { suffix: string; label: string; mark: string; tone: string }[] = [
  { suffix: '-node', label: 'Node.js', mark: 'JS', tone: 'lime' },
  { suffix: '-python', label: 'Python', mark: 'PY', tone: 'yellow' },
  { suffix: '-go', label: 'Go', mark: 'GO', tone: 'cyan' },
];
const CATEGORY_TONE: Record<TemplateView['category'], string> = {
  hello: 'lime',
  function: 'blue',
  'stateless-contract': 'magenta',
  ai: 'orange',
};

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
    tone: runtime?.tone ?? CATEGORY_TONE[t.category],
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

  const tile = (t: TemplateView) => {
    const { runtime, mark, tone } = look(t);
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
          'group flex min-w-0 items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
          on
            ? 'border-brand bg-brand/5'
            : 'border-border hover:border-border-secondary hover:bg-accent/40'
        )}
      >
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--art-ground)] font-mono text-[11px] font-semibold"
          style={{ color: `var(--art-${tone})` }}
        >
          {mark}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span id={`${uid}-${t.name}`} className="truncate font-mono text-[13px] font-semibold">
              {t.name}
            </span>
            {runtime && (
              <span className="shrink-0 rounded border border-border px-1.5 text-[10.5px] leading-4 text-muted-foreground">
                {runtime}
              </span>
            )}
            <Check
              aria-hidden
              className={cn(
                'ml-auto h-4 w-4 shrink-0 text-brand',
                on ? 'opacity-100' : 'opacity-0'
              )}
            />
          </span>
          <span id={`${uid}-${t.name}-desc`} className="text-xs leading-5 text-muted-foreground">
            {t.description}
          </span>
        </span>
      </button>
    );
  };

  return (
    // Sized by its own width: it sits beside the New app rail, or beside the
    // Fold layout's strip, so the window says little about the room it has.
    <div className="@container flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Pick a starter to prefill your app. Its scaffold comes from the CLI once the app exists.
      </p>
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
              className="flex flex-col gap-2.5"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <h2
                  id={`${uid}-cat-${category}`}
                  className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground"
                >
                  {CATEGORY[category].label}
                </h2>
                <p className="text-xs text-muted-foreground">{CATEGORY[category].blurb}</p>
              </div>
              <div className="grid grid-cols-1 gap-2 @xl:grid-cols-2">
                {list.filter((t) => t.category === category).map(tile)}
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
            <div className="flex min-w-0 items-center gap-1 rounded-md bg-[var(--art-ground)] py-1 pl-3 pr-1">
              <span
                aria-hidden="true"
                className="select-none font-mono text-xs text-[var(--art-mute)]"
              >
                $
              </span>
              <code className="min-w-0 overflow-x-auto whitespace-nowrap font-mono text-xs text-[var(--art-light)]">
                gregale init --template {chosen}
              </code>
              <CopyIconButton
                text={`gregale init --template ${chosen}`}
                label={`gregale init --template ${chosen}`}
                className="ml-auto text-[var(--art-light)] hover:bg-transparent hover:text-[var(--art-light)]"
              />
            </div>
          </div>
          {action}
        </section>
      )}
    </div>
  );
}
