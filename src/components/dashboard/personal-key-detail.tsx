import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { usePaletteKey } from '@/lib/api/palette';
import { errorMessage } from '@/lib/api/errors';

export function PersonalKeyDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { account } = useAuth();
  const q = usePaletteKey(account?.id, id);
  const key = q.data;
  return (
    <Modal
      open
      onClose={onClose}
      title="API key details"
      description="Metadata only. Stored key values cannot be recovered."
    >
      {q.isPending || q.isFetching ? (
        <p role="status">Reading API key metadata…</p>
      ) : q.error ? (
        <div role="alert">
          <p>{errorMessage(q.error)}</p>
          <Button variant="outline" onClick={() => void q.refetch()}>
            Retry key details
          </Button>
        </div>
      ) : !key ? (
        <p>This API key is unavailable for this account.</p>
      ) : (
        <dl className="flex flex-col gap-3">
          {[
            ['Label', key.label],
            ['ID', key.id],
            ['Scopes', key.scopes.join(', ')],
            ['Created', key.created],
            ['Last used', key.lastUsed ?? 'Never'],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="label-mono text-muted-foreground">{label}</dt>
              <dd className="break-all text-sm">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Modal>
  );
}
