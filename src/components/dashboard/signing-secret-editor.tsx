import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { errorMessage } from '@/lib/api/errors';

/** Rotation requires a customer-selected secret, so the receiver can be configured first. */
export function SigningSecretEditor({
  onSave,
  onClose,
}: {
  onSave: (secret: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const id = useId();
  const [secret, setSecret] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal open title="Replace signing secret" onClose={onClose} width="max-w-lg">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!secret || secret.length > 256 || pending) return;
          setPending(true);
          setError('');
          try {
            await onSave(secret);
            setSecret('');
            onClose();
          } catch (failure) {
            setError(errorMessage(failure));
          } finally {
            setPending(false);
          }
        }}
      >
        <p className="text-sm text-muted-foreground">
          Configure your receiver with the replacement first. After saving, new attempts use this
          secret. Requests already in flight may still use the previous one. Reads never return it.
        </p>
        <label htmlFor={id} className="flex flex-col gap-1 text-sm">
          Replacement signing secret
          <input
            id={id}
            type="password"
            autoComplete="new-password"
            required
            maxLength={256}
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            className={FIELD}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <Button type="submit" disabled={pending || !secret}>
          {pending ? 'Replacing…' : 'Replace secret'}
        </Button>
      </form>
    </Modal>
  );
}
