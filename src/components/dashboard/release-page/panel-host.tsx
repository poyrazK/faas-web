import type { ReactNode } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Modal } from '@/components/ui/modal';
import type { ReleasePageSearch, ReleasePanel } from './panels';

export interface ReleasePanelSpec {
  title: string;
  /** A max-width utility; popups default to `max-w-3xl`. */
  width?: string;
  render: () => ReactNode;
}

/**
 * The popup a release page has open, read from and written to `?panel=`.
 * Opening pushes a history entry, so Back closes the popup before it leaves
 * the page; closing replaces it.
 */
export function useReleasePanel(): {
  panel?: ReleasePanel;
  open: (panel: ReleasePanel) => void;
  close: () => void;
} {
  const search = useSearch({ strict: false }) as ReleasePageSearch;
  const navigate = useNavigate();
  return {
    panel: search.panel,
    open: (panel) =>
      void navigate({
        to: '.',
        search: ((prev: ReleasePageSearch) => ({ ...prev, panel })) as never,
        resetScroll: false,
      }),
    close: () =>
      void navigate({
        to: '.',
        search: ((prev: ReleasePageSearch) => {
          const rest = { ...prev };
          delete rest.panel;
          return rest;
        }) as never,
        replace: true,
        resetScroll: false,
      }),
  };
}

/** One centred popup for the open panel; nothing when none is open. */
export function ReleasePanelHost({
  panel,
  onClose,
  panels,
  releaseName,
}: {
  panel?: ReleasePanel;
  onClose: () => void;
  panels: Partial<Record<ReleasePanel, ReleasePanelSpec>>;
  releaseName: string;
}) {
  const spec = panel ? panels[panel] : undefined;
  if (!spec) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={spec.title}
      description={releaseName}
      width={spec.width ?? 'max-w-3xl'}
    >
      <div className="max-h-[calc(100dvh-14rem)] overflow-y-auto overscroll-contain p-1">
        {spec.render()}
      </div>
    </Modal>
  );
}
