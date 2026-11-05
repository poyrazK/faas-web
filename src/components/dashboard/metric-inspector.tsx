import { createContext, lazy, Suspense, useContext, type ReactNode } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Modal } from '@/components/ui/modal';
import {
  clearDetailSearch,
  detailRequest,
  detailSearch,
  METRIC_LABELS,
  validateMetricDetailSearch,
  type MetricDetailRequest,
} from './metric-detail-search';

const DetailBody = lazy(() => import('./metric-detail'));
const InspectContext = createContext<(request: MetricDetailRequest) => void>(() => {});
export const useMetricInspector = () => useContext(InspectContext);

/** The route remains underneath the dialog; Back and shared URLs preserve scope. */
export function MetricInspectorProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate({ from: '/dashboard' });
  const { search, pathname, hash } = useRouterState({ select: (state) => state.location });
  const selected = detailRequest(validateMetricDetailSearch(search));
  const open = (request: MetricDetailRequest) =>
    void navigate({
      to: pathname,
      hash,
      search: (previous) => ({ ...clearDetailSearch(previous), ...detailSearch(request) }),
      resetScroll: false,
    });
  const close = () =>
    void navigate({
      to: pathname,
      hash,
      search: (previous) => clearDetailSearch(previous),
      replace: true,
      resetScroll: false,
    });
  const change = (request: MetricDetailRequest) =>
    void navigate({
      to: pathname,
      hash,
      search: (previous) => ({ ...clearDetailSearch(previous), ...detailSearch(request) }),
      replace: true,
      resetScroll: false,
    });
  return (
    <InspectContext.Provider value={open}>
      {children}
      <Modal
        open={Boolean(selected)}
        onClose={close}
        title={
          selected
            ? `${METRIC_LABELS[selected.metric]} · ${selected.app ?? 'All apps'}`
            : 'Metric details'
        }
        width="max-w-5xl"
        description="Explore this metric without leaving your page."
      >
        {selected && (
          <Suspense fallback={<p role="status">Loading metric details…</p>}>
            <DetailBody request={selected} onChange={change} />
          </Suspense>
        )}
      </Modal>
    </InspectContext.Provider>
  );
}
