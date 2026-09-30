import { useRef, useState, type FormEvent } from 'react';
import { Github } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { issueCSRF } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';

/** Fetch only the CSRF proof; the OAuth redirect needs a native browser POST. */
export function GitHubConnect({
  disabled = false,
  onConnect,
}: {
  disabled?: boolean;
  onConnect?: () => void;
}) {
  const tokenInput = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || submitting.current) return;
    const form = event.currentTarget;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const token = await issueCSRF('connect_github');
      if (!form.isConnected || !tokenInput.current) return;
      tokenInput.current.value = token;
      onConnect?.();
      // Bypass this submit handler after placing the proof in the form.
      HTMLFormElement.prototype.submit.call(form);
    } catch (err) {
      setError(errorMessage(err));
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form method="post" action="/dashboard/install/connect" onSubmit={connect}>
      <input ref={tokenInput} type="hidden" name="csrf_token" />
      <Button
        type="submit"
        size="sm"
        variant="cta"
        className="gap-1.5"
        disabled={disabled || pending}
      >
        <Github className="h-3.5 w-3.5" />
        {pending ? 'Connecting…' : 'Connect GitHub'}
      </Button>
      {error && (
        <p role="alert" className="mt-2 max-w-md text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
