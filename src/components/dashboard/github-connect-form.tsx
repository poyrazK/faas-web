import { useRef, useState, type FormEvent } from 'react';
import { Github } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { issueCSRF } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';

export function GitHubConnectForm({
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
      if (!token) throw new Error('Could not prepare the connection. Please try again.');
      if (!form.isConnected || !tokenInput.current) return;
      tokenInput.current.value = token;
      onConnect?.();
      // Submit as a browser navigation so GitHub's consent redirect opens.
      // Fetching this POST would follow the redirect without leaving the page.
      form.submit();
    } catch (err) {
      submitting.current = false;
      setPending(false);
      setError(errorMessage(err));
    }
  }

  return (
    <form
      method="post"
      action="/dashboard/install/connect"
      onSubmit={connect}
      className="flex flex-col items-start gap-2"
    >
      <input ref={tokenInput} type="hidden" name="csrf_token" defaultValue="" />
      <input type="hidden" name="return_to" value="/dashboard/settings?section=integrations" />
      <Button
        type="submit"
        size="sm"
        variant="cta"
        className="gap-1.5"
        disabled={disabled}
        busy={pending}
      >
        <Github className="h-3.5 w-3.5" />
        Connect GitHub
      </Button>
      {error && (
        <p role="alert" className="max-w-md text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
