import type { ComponentType, SVGProps } from 'react';
import {
  ArrowRight,
  Box3dPoint,
  Check,
  GitBranch,
  Import,
  NavArrowRight,
  PlusSquare,
  RefreshDouble,
  ViewGrid,
} from 'iconoir-react';
import { cn } from '@/lib/utils';
import type { AppSource } from './new-app-source';
import { SOURCES } from './new-app-sources';

const ICON: Record<AppSource, ComponentType<SVGProps<SVGSVGElement>>> = {
  git: GitBranch,
  template: ViewGrid,
  empty: PlusSquare,
  container: Box3dPoint,
  worker: RefreshDouble,
  import: Import,
};

const OTHERS: AppSource[] = ['template', 'empty', 'container', 'worker', 'import'];

/**
 * How a new app starts. Git leads as the one primary card, since most people
 * arrive with code in a repository; the other five follow as a compact list.
 * Each choice is a button in the source form (`name="source-<id>"`), so
 * validation can focus it, and choosing one moves the wizard on.
 */
export function NewAppChooser({
  uid,
  formId,
  selected,
  onSelect,
  errorId,
  single = false,
}: {
  uid: string;
  formId: string;
  selected?: AppSource;
  onSelect: (id: AppSource) => void;
  errorId?: string;
  /** Onboarding: Git alone. */
  single?: boolean;
}) {
  // What every choice shares: its place in the form, its state, its names.
  const choice = (id: AppSource) => ({
    type: 'button' as const,
    name: `source-${id}`,
    form: formId,
    'data-source': id,
    onClick: () => onSelect(id),
    'aria-pressed': selected === id,
    'aria-labelledby': `${uid}-${id}-name`,
    'aria-describedby': cn(`${uid}-${id}-desc`, errorId),
  });
  const copy = (id: AppSource) => SOURCES.find((option) => option.id === id)!;
  const Git = ICON.git;

  return (
    <div className="flex flex-col gap-8">
      <button
        {...choice('git')}
        className={cn(
          'group flex w-full items-center gap-4 rounded-xl border bg-card p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
          selected === 'git'
            ? 'border-brand'
            : 'border-border hover:border-border-secondary hover:bg-accent/30'
        )}
      >
        <span
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors',
            selected === 'git' ? 'bg-brand/15 text-brand' : 'bg-muted text-foreground'
          )}
        >
          <Git aria-hidden className="h-5 w-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span id={`${uid}-git-name`} className="text-base font-medium">
            {copy('git').name}
          </span>
          <span id={`${uid}-git-desc`} className="text-sm text-muted-foreground">
            {copy('git').desc}
          </span>
        </span>
        {/* What pressing the card does; the card itself is the button. */}
        <span
          aria-hidden="true"
          className="hidden h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-sm font-medium text-primary-foreground transition-colors group-hover:bg-brand-hover sm:inline-flex"
        >
          Continue
          <ArrowRight className="h-4 w-4" />
        </span>
      </button>

      {!single && (
        <section role="group" aria-labelledby={`${uid}-others`} className="flex flex-col gap-3">
          <h2 id={`${uid}-others`} className="text-sm font-medium text-muted-foreground">
            Other ways to start
          </h2>
          <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
            {OTHERS.map((id) => {
              const Icon = ICON[id];
              return (
                <button
                  key={id}
                  {...choice(id)}
                  className={cn(
                    // Rows round with the list, so a hover, a selection or a
                    // focus ring follows its corners instead of being clipped.
                    'group flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors first:rounded-t-[11px] last:rounded-b-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand',
                    selected === id ? 'bg-accent/50' : 'hover:bg-accent/40'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors',
                      selected === id ? 'bg-brand/15 text-brand' : 'bg-muted text-foreground'
                    )}
                  >
                    <Icon aria-hidden className="h-[18px] w-[18px]" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span id={`${uid}-${id}-name`} className="text-sm font-medium">
                      {copy(id).name}
                    </span>
                    <span id={`${uid}-${id}-desc`} className="text-[13px] text-muted-foreground">
                      {copy(id).desc}
                    </span>
                  </span>
                  {selected === id ? (
                    <Check aria-hidden className="h-4 w-4 shrink-0 text-brand" />
                  ) : (
                    <NavArrowRight
                      aria-hidden
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transform-none"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
