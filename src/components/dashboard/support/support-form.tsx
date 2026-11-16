import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, Textarea, FieldError } from '@/components/ui/field';
import { useSupportWrite, type SupportScope } from '@/lib/api/support';
import type { components } from '@/lib/api/schema';
import { Sheet } from '../kit/sheet';
import { SUPPORT_CATEGORIES, SupportWriteError, supportTextError } from './support-bits';

type Create = components['schemas']['CreateSupportTicketRequest'];
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

export function SupportForm({
  scope,
  onClose,
  onCreated,
}: {
  scope: SupportScope;
  onClose: () => void;
  onCreated: (ticket: string) => void;
}) {
  const write = useSupportWrite(scope);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<Create['category']>('deployment');
  const [priority, setPriority] = useState<Create['priority']>('normal');
  const [context, setContext] = useState({ app_id: '', deployment_id: '', request_id: '' });
  const [error, setError] = useState<string>();
  const success = (result: Awaited<ReturnType<typeof write.run>>) => {
    if ('ticket_id' in result) onCreated(result.ticket_id);
  };
  return (
    <Sheet
      open
      onClose={() => {
        if (!write.locked) onClose();
      }}
      title="Start a conversation"
      footer={
        <Button form="support-create" type="submit" disabled={write.locked}>
          {write.isPending ? 'Sending…' : 'Send to support'}
        </Button>
      }
    >
      <form
        id="support-create"
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (write.locked) return;
          const invalid =
            supportTextError(subject, 200, 'A subject') ??
            supportTextError(body, 10_000, 'A message') ??
            (context.app_id && !UUID.test(context.app_id) ? 'App ID must be a UUID.' : undefined) ??
            (context.deployment_id && !UUID.test(context.deployment_id)
              ? 'Deployment ID must be a UUID.'
              : undefined) ??
            (context.request_id && supportTextError(context.request_id, 200, 'Request ID'));
          if (invalid) {
            setError(invalid);
            return;
          }
          setError(undefined);
          const identifiers = Object.fromEntries(
            Object.entries(context).filter(([, value]) => value)
          );
          void write
            .run({
              kind: 'create',
              body: {
                subject,
                category,
                priority,
                body,
                ...(Object.keys(identifiers).length ? { context: identifiers } : {}),
              },
            })
            .then(success)
            .catch(() => {});
        }}
      >
        <p className="text-sm text-muted-foreground">
          {scope.org
            ? `Shared with owners and admins of ${scope.org}.`
            : 'A private conversation for your personal account.'}
        </p>
        <fieldset disabled={write.locked} className="space-y-5">
          <label className="block space-y-2 text-sm">
            <span>Subject</span>
            <Input
              autoFocus
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="What do you need help with?"
              required
              aria-describedby={error ? 'support-create-error' : undefined}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-2 text-sm">
              <span>Topic</span>
              <Select
                className="w-full"
                value={category}
                onChange={(e) => setCategory(e.target.value as Create['category'])}
              >
                {SUPPORT_CATEGORIES.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block space-y-2 text-sm">
              <span>Priority</span>
              <Select
                className="w-full"
                value={priority}
                onChange={(e) => setPriority(e.target.value as Create['priority'])}
              >
                {['low', 'normal', 'high', 'urgent'].map((value) => (
                  <option key={value} value={value}>
                    {value[0].toUpperCase() + value.slice(1)}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <label className="block space-y-2 text-sm">
            <span>Message</span>
            <Textarea
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What happened, and what were you expecting?"
              required
              aria-describedby="support-message-help"
            />
          </label>
          <p id="support-message-help" className="text-xs text-muted-foreground">
            Include only what we need to help. Do not paste passwords, API keys, or private logs.
            Nothing is attached automatically.
          </p>
          <details className="space-y-4 text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Add app or request identifiers
            </summary>
            {(
              [
                ['app_id', 'App ID'],
                ['deployment_id', 'Deployment ID'],
                ['request_id', 'Request ID'],
              ] as const
            ).map(([key, label]) => (
              <label className="flex flex-col gap-2" key={key}>
                <span>
                  {label} <span className="text-muted-foreground">(optional)</span>
                </span>
                <Input
                  value={context[key]}
                  onChange={(e) => setContext({ ...context, [key]: e.target.value })}
                />
              </label>
            ))}
          </details>
        </fieldset>
        {error && <FieldError id="support-create-error">{error}</FieldError>}
        <SupportWriteError write={write} onSuccess={success} />
      </form>
    </Sheet>
  );
}
