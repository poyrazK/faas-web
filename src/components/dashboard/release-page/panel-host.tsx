import type { ReactNode } from 'react';
import { useNavigate, useRouter, useRouterState, useSearch } from '@tanstack/react-router';
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
 * the page. Closing a popup this page opened steps back over that entry, so
 * no duplicate is left behind; one a link opened is closed in place.
 */
export function useReleasePanel(): {
  panel?: ReleasePanel;
  open: (panel: ReleasePanel, hash?: string) => void;
  close: () => void;
} {
  const search = useSearch({ strict: false }) as ReleasePageSearch;
  const navigate = useNavigate();
  const router = useRouter();
  const pushed = useRouterState({
    select: (state) => Boolean((state.location.state as { releasePanel?: boolean }).releasePanel),
  });
  return {
    panel: search.panel,
    open: (panel, hash) =>
      void navigate({
        to: '.',
        search: ((prev: ReleasePageSearch) => ({ ...prev, panel })) as never,
        hash: hash ?? '',
        state: ((prev: Record<string, unknown>) => ({ ...prev, releasePanel: true })) as never,
        resetScroll: false,
      }),
    close: () =>
      pushed
        ? router.history.back()
        : void navigate({
            to: '.',
            search: ((prev: ReleasePageSearch) => {
              const rest = { ...prev };
              delete rest.panel;
              return rest;
            }) as never,
            hash: '',
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
