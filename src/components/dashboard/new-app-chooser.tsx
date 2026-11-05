import type { ComponentType, SVGProps } from 'react';
import {
  Box3dPoint,
  Check,
  Code,
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
  function: Code,
  template: ViewGrid,
  empty: PlusSquare,
  container: Box3dPoint,
  worker: RefreshDouble,
  import: Import,
};

const OTHERS: AppSource[] = ['function', 'template', 'empty', 'container', 'worker', 'import'];

/**
 * How a new app starts. Git leads a compact list of seven equally legible choices.
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
  const row = (id: AppSource) => {
    const Icon = ICON[id];
    return (
      <button
        key={id}
        {...choice(id)}
        className={cn(
          'group flex min-h-16 w-full items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          selected === id
            ? 'border-brand/50 bg-brand/5'
            : 'border-border hover:border-border-secondary hover:bg-muted/40'
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground group-hover:text-brand">
          <Icon aria-hidden className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span id={`${uid}-${id}-name`} className="text-sm font-medium">
            {copy(id).name}
          </span>
          <span id={`${uid}-${id}-desc`} className="text-xs leading-relaxed text-muted-foreground">
            {copy(id).desc}
          </span>
        </span>
        {selected === id ? (
          <Check aria-hidden className="size-4 shrink-0 text-brand" />
        ) : (
          <NavArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>
    );
  };
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 sm:p-6">
      <div className="mb-3">
        <h2 className="text-base font-semibold">What are you starting with?</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Choose the option that matches your code. You’ll review everything before creating an app.
        </p>
      </div>
      {row('git')}
      {!single && (
        <section role="group" aria-labelledby={`${uid}-others`} className="flex flex-col gap-2">
          <h3 id={`${uid}-others`} className="sr-only">
            Other ways to start
          </h3>
          {OTHERS.map(row)}
        </section>
      )}
    </div>
  );
}
