import { useId, useState } from 'react';
import { Refresh } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { CopyIconButton } from '@/components/ui/copy-button';
import { FIELD, FieldError, fieldErrorProps } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { errorMessage } from '@/lib/api/errors';
import { cn } from '@/lib/utils';

/** apid's cap for a webhook signing secret (AppWebhookSecretMaxBytes / AlertRuleWebhookSecretMaxBytes). */
export const WEBHOOK_SECRET_MAX = 256;

/** 32 random bytes, base64url without padding: 43 characters. */
export function generateWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function webhookSecretError(secret: string): string | undefined {
  return secret.length >= 1 && secret.length <= WEBHOOK_SECRET_MAX
    ? undefined
    : `Enter a secret of 1 to ${WEBHOOK_SECRET_MAX} characters.`;
}

/**
 * Rotation for a webhook or alert signing secret.
 *
 * apid no longer mints the replacement: rotate-secret takes the new secret in
 * the body and seals it, and there is no overlap with the old one. So the
 * person has to see the new value before it is saved, to install it on the
 * receiver first. A strong one is generated on open; it can be replaced with
 * one pasted from a secret manager.
 */
export function RotateSecretDialog({
  name,
  onRotate,
  onClose,
}: {
  /** What the secret signs for, in the title: a rule name or a target URL. */
  name: string;
  onRotate: (secret: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [secret, setSecret] = useState(generateWebhookSecret);
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const error = attempted ? webhookSecretError(secret) : undefined;

  const submit = async () => {
    setAttempted(true);
    if (webhookSecretError(secret) || pending) return;
    setPending(true);
    setFailure(null);
    try {
      await onRotate(secret);
      onClose();
    } catch (err) {
      // Keep the dialog and the secret: it may already be on the receiver.
      setFailure(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      title={`Rotate the secret for ${name}?`}
      description="Deliveries signed with the old secret stop verifying immediately. Install the new one on your receiver first."
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" busy={pending} onClick={() => void submit()}>
            {pending ? 'Rotating…' : 'Rotate secret'}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor={inputId} className="label-mono text-muted-foreground">
          New secret
        </label>
        <div className="flex items-center gap-1.5">
          <input
            id={inputId}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoFocus
            className={cn(FIELD, 'flex-1 font-mono')}
            {...fieldErrorProps(error, errorId)}
          />
          <CopyIconButton text={secret} label="new secret" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setSecret(generateWebhookSecret());
              setFailure(null);
            }}
          >
            <Refresh className="h-3.5 w-3.5" />
            Generate another
          </Button>
        </div>
        {error && <FieldError id={errorId}>{error}</FieldError>}
        <p className="text-xs text-muted-foreground">
          The secret is sealed on save and can't be shown again.
        </p>
        {failure && (
          <p role="alert" className="text-xs text-[color:var(--status-critical)]">
            {failure}
          </p>
        )}
      </form>
    </Modal>
  );
}
