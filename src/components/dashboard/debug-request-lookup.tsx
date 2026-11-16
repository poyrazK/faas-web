import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Open one request's evidence by the `x-faas-request-id` a response carried.
 * apid resolves it through the app's durable request-ID journal, so it is
 * not limited to the sample above (GET .../debug/requests/{req_id}/evidence,
 * 1–128 characters; an ID from another app answers not found).
 */
export function DebugRequestLookup({ onOpen }: { onOpen: (requestId: string) => void }) {
  const [value, setValue] = useState('');
  const id = useId();
  const trimmed = value.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 128;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) onOpen(trimmed);
  };
  return (
    <form
      aria-label="Open a request by ID"
      onSubmit={submit}
      className="flex items-center gap-1.5 text-xs"
    >
      <label htmlFor={id} className="sr-only">
        Request ID (x-faas-request-id)
      </label>
      <Input
        id={id}
        value={value}
        maxLength={128}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Find a request by ID"
        title="The x-faas-request-id from a response header or a log line"
        className="h-8 w-48 max-w-full font-mono text-xs placeholder:font-sans"
      />
      <Button
        type="submit"
        size="xs"
        variant="ghost"
        disabled={!valid}
        aria-label="Open request details"
      >
        Open
      </Button>
    </form>
  );
}
