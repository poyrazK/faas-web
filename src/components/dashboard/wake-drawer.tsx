import { Modal } from '@/components/ui/modal';
import { WakeWaterfall } from './wake-waterfall';

/**
 * One wake's waterfall over the page that opened it. The host owns the URL:
 * it passes the `wake` search param in and removes it in `onClose`. Without
 * an app slug the API cannot be asked, so the drawer stays shut.
 */
export function WakeDrawer({
  slug,
  wakeId,
  onClose,
}: {
  slug?: string;
  wakeId?: string;
  onClose: () => void;
}) {
  const open = Boolean(slug && wakeId);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Wake"
      description={slug ? `App ${slug}` : undefined}
      placement="right"
    >
      {slug && wakeId ? <WakeWaterfall slug={slug} wakeId={wakeId} /> : null}
    </Modal>
  );
}
