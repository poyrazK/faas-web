import type { ReactNode } from 'react';
import { NavArrowRight } from 'iconoir-react';
import { cn } from '@/lib/utils';
import { InlinePhase, type QueryPhase } from '../primitives';
import type { ReleasePanel } from './panels';
import type { ReleaseContext } from './release-page';

/**
 * One release fact as a bento tile. The title row is the button that opens the
 * tile's popup; a retry stays a separate control beside it, never nested.
 */
export function ReleaseTile({
  title,
  phase,
  value,
  line,
  hint,
  emptyMessage,
  error,
  onRetry,
  onOpen,
  span = 1,
}: {
  title: string;
  phase: QueryPhase;
  value?: ReactNode;
  line?: ReactNode;
  hint: string;
  emptyMessage?: string;
  error?: unknown;
  onRetry?: () => void;
  onOpen: () => void;
  span?: 1 | 2;
}) {
  return (
    <div
      role="group"
      aria-label={title}
      className={cn(
        'surface group relative flex min-h-28 flex-col gap-2 rounded-xl bg-card p-4 transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-muted/30',
        span === 2 && 'md:col-span-2'
      )}
    >
      <button
        type="button"
        aria-label={`Open ${title}`}
        onClick={onOpen}
        className="flex items-center justify-between gap-2 text-left outline-none after:absolute after:inset-0 after:rounded-xl"
      >
        <span className="bento-label">{title}</span>
        <NavArrowRight
          aria-hidden="true"
          className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </button>
      {phase === 'ready' ? (
        <>
          {value != null && (
            <span className="text-lg leading-6 font-medium tracking-[-0.01em]">{value}</span>
          )}
          {line != null && <span className="text-sm text-muted-foreground">{line}</span>}
        </>
      ) : (
        <div className="relative z-10">
          <InlinePhase phase={phase} error={error} emptyMessage={emptyMessage} onRetry={onRetry} />
        </div>
      )}
      <span className="mt-auto text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}

export function ReleaseTileGrid({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Release tiles"
      className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4"
    >
      {children}
    </section>
  );
}

/** A tile and the popup it opens, registered once on the release page. */
export interface ReleaseTileSpec {
  panel: ReleasePanel;
  title: string;
  span?: 1 | 2;
  /** Popup width; `max-w-3xl` when unset. */
  width?: string;
  /** Present only when the release has this thing. */
  when?: (ctx: ReleaseContext) => boolean;
  Tile: (props: { ctx: ReleaseContext; onOpen: () => void }) => ReactNode;
  Popup: (props: { ctx: ReleaseContext }) => ReactNode;
}
