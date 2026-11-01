import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { useLogDrainKinds } from '@/lib/api/log-drain-capabilities';
import { useUpdateLogDrain, type LogDrain } from '@/lib/api/log-drains';
import {
  LogDrainFields,
  LogDrainProblem,
  draftErrors,
  draftFrom,
  updateBody,
} from './log-drain-form';

/**
 * Changes a destination in place (PATCH): its format, URL or Datadog site, and
 * its credential. The stored credential is never read back — an empty field
 * keeps it, a new value replaces it — and only changed fields are sent.
 */
export function EditLogDrain({
  slug,
  drain,
  onClose,
}: {
  slug: string;
  drain: LogDrain;
  onClose: () => void;
}) {
  const update = useUpdateLogDrain(slug);
  const kinds = useLogDrainKinds();
  const { toast } = useToast();
  const [draft, setDraft] = useState(() => draftFrom(drain));
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setAttempted(true);
    if (Object.keys(draftErrors(draft, drain)).length) return;
    const body = updateBody(draft, drain);
    if (!Object.keys(body).length) return onClose();
    setError(null);
    try {
      await update.mutateAsync({ id: drain.id, body });
      toast({ kind: 'success', title: 'Log destination updated' });
      onClose();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit log destination"
      description="Only what you change is sent. Stored credentials are never shown; leave a credential empty to keep it."
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" busy={update.isPending} onClick={() => void submit()}>
            Save changes
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <LogDrainFields
          draft={draft}
          onChange={setDraft}
          kinds={kinds}
          existing={drain}
          attempted={attempted}
        />
        <LogDrainProblem error={error} />
      </form>
    </Modal>
  );
}
