import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api/errors';
import { queueBindingsKey, readQueueBindingContext } from '@/lib/api/queue-bindings';
import type { components } from '@/lib/api/schema';
import { clearQueueBindingWrite, type QueueBindingWrite } from '@/lib/queue-binding-write';

type Plan = components['schemas']['CapabilitiesResponse']['plan'];

export function QueueBindingOrphan({ write, plan }: { write: QueueBindingWrite; plan: Plan }) {
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [inspected, setInspected] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [cleared, setCleared] = useState(false);
  const alive = useRef(true);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.abort();
    };
  }, []);

  async function inspect() {
    if (busy || cleared) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage('');
    setInspected(false);
    setAcknowledged(false);
    try {
      const current = await readQueueBindingContext(
        write.accountId,
        write.slug,
        plan,
        controller.signal
      );
      if (!alive.current || current.app.id !== write.appId) {
        if (alive.current)
          setMessage('The app identity changed. This recovery cannot be cleared here.');
        return;
      }
      const row = current.bindings.find((binding) => binding.id === write.bindingId);
      setMessage(
        row
          ? `Binding ${row.id} currently reports ${row.enabled ? 'enabled' : 'paused'} on queue ${row.queue_name}. This does not prove which request changed it.`
          : `Binding ${write.bindingId} is absent from the current list. This does not prove which request removed it.`
      );
      setInspected(true);
      await cache.invalidateQueries({ queryKey: queueBindingsKey(write.accountId, write.slug) });
    } catch (error) {
      if (alive.current && !controller.signal.aborted) setMessage(errorMessage(error));
    } finally {
      if (alive.current) setBusy(false);
      if (pending.current === controller) pending.current = null;
    }
  }

  function clear() {
    if (!inspected || !acknowledged || cleared || busy) return;
    clearQueueBindingWrite(write.accountId, write.slug, write.bindingId);
    setCleared(true);
  }

  if (cleared) return <p role="status">Reviewed recovery cleared.</p>;
  return (
    <div className="space-y-2 rounded border border-border p-3 text-sm">
      <p>
        {write.action === 'delete' ? 'Deletion' : 'Update'} of {write.bindingId} has an unconfirmed
        outcome.
      </p>
      <Button variant="outline" disabled={busy} onClick={() => void inspect()}>
        Inspect missing binding
      </Button>
      {message && <p role="status">{message}</p>}
      {inspected && (
        <>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>
              I inspected the current binding list and understand it does not prove which request
              changed the binding.
            </span>
          </label>
          <Button variant="outline" disabled={busy || !acknowledged} onClick={clear}>
            Clear reviewed recovery
          </Button>
        </>
      )}
    </div>
  );
}
