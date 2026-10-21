import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { AppSource } from './new-app-source';
import { SOURCES, SOURCE_GROUPS } from './new-app-sources';
import { SourceShader } from './source-shader';
import './new-app-bento.css';

const CORNERS = ['tl', 'tr', 'bl', 'br'] as const;

/**
 * The New app sources as a bento: one hairline grid, Git as the hero cell.
 * Groups stay in the accessibility tree (`role="group"`) but are laid out with
 * `display: contents`, so every cell sits directly in the grid. DOM order is
 * source order, so Tab walks Git → Template → … → Import whatever the layout.
 */
export function NewAppBento({
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
  single?: boolean;
}) {
  // The cell under the pointer or focus plays its scene; the rest hold still.
  const [hot, setHot] = useState<AppSource | null>(null);
  const cell = (id: AppSource, group: string) => {
    // SOURCES is in group order, so its position is the cell's number.
    const index = SOURCES.findIndex((option) => option.id === id) + 1;
    const s = SOURCES[index - 1];
    return (
      <button
        key={id}
        type="button"
        name={`source-${id}`}
        form={formId}
        data-source={id}
        onClick={() => onSelect(id)}
        aria-pressed={selected === id}
        aria-labelledby={`${uid}-${id}-name`}
        aria-describedby={cn(`${uid}-${id}-desc`, errorId)}
        data-active={hot === id || selected === id}
        onPointerEnter={() => setHot(id)}
        onPointerLeave={() => setHot((h) => (h === id ? null : h))}
        onFocus={() => setHot(id)}
        onBlur={() => setHot((h) => (h === id ? null : h))}
        className="nab-cell"
      >
        {CORNERS.map((c) => (
          <span key={c} aria-hidden="true" className="nab-mark" data-corner={c} />
        ))}
        <SourceShader id={id} active={hot === id || selected === id} />
        {/* One cell numbers nothing: onboarding shows Git alone. */}
        {!single && (
          <span className="flex items-center justify-between gap-3 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
            <span>{group}</span>
            <span>{String(index).padStart(2, '0')}</span>
          </span>
        )}
        <span className="flex min-w-0 flex-col gap-1">
          <span id={`${uid}-${id}-name`} className="text-sm font-medium text-foreground">
            {s.name}
          </span>
          <span id={`${uid}-${id}-desc`} className="text-xs leading-5 text-muted-foreground">
            {s.desc}
          </span>
        </span>
      </button>
    );
  };

  if (single) {
    return (
      <div className="nab-wrap">
        <div className="nab-grid" data-single="">
          {cell('git', SOURCE_GROUPS[0].title)}
        </div>
      </div>
    );
  }

  return (
    <div className="nab-wrap">
      <div className="nab-grid">
        {SOURCE_GROUPS.map((group, g) => (
          <div
            key={group.title}
            role="group"
            aria-labelledby={`${uid}-group-${g}`}
            className="contents"
          >
            <h2 id={`${uid}-group-${g}`} className="sr-only">
              {group.title}
            </h2>
            {group.sources.map((id) => cell(id, group.title))}
          </div>
        ))}
      </div>
    </div>
  );
}
