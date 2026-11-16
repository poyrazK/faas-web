import { useEffect, useRef, useState } from 'react';
import { NavArrowLeft, RefreshDouble } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Textarea, FieldError } from '@/components/ui/field';
import { useConfirm } from '@/components/ui/confirm';
import { useAuth } from '@/lib/auth';
import {
  useSupportTicket,
  useSupportMessages,
  useSupportSurvey,
  useSupportWrite,
  useMarkSupportRead,
  type SupportScope,
  type SupportTicket,
} from '@/lib/api/support';
import { PageHeader, Panel, LoadingState } from '../primitives';
import { Pill } from '../resource-table';
import {
  SupportGate,
  SupportLink,
  SupportStatus,
  SupportReadState,
  SupportWriteError,
  supportTextError,
} from './support-bits';

export function SupportConversationPage({
  org = null,
  ticket,
}: {
  org?: string | null;
  ticket: string;
}) {
  const { account } = useAuth();
  if (!account) return <LoadingState />;
  const scope = { accountId: account.id, org };
  return (
    <SupportGate key={`${account.id}:${org}:${ticket}`} scope={scope}>
      <SupportConversation scope={scope} id={ticket} />
    </SupportGate>
  );
}

export function SupportConversation({ scope, id }: { scope: SupportScope; id: string }) {
  const query = useSupportTicket(scope, id);
  const messages = useSupportMessages(scope, id);
  const read = useMarkSupportRead(scope, id);
  const lastRead = useRef(0);
  const pages = messages.data?.pages;
  const lastPage = pages?.at(-1);
  const through = lastPage?.observedThrough ?? 0;
  const allRead = Boolean(
    lastPage && !lastPage.next_cursor && !messages.isFetching && !messages.error
  );
  useEffect(() => {
    if (
      !allRead ||
      through <= lastRead.current ||
      read.isPending ||
      document.visibilityState === 'hidden'
    )
      return;
    lastRead.current = through;
    read.mutate(through);
  }, [allRead, through, read]);
  const ticket = query.data;
  return (
    <div className="space-y-5">
      <SupportLink
        org={scope.org}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <NavArrowLeft className="size-4" />
        All conversations
      </SupportLink>
      <PageHeader
        title="Support"
        meta={
          <>
            <Pill label="Preview" />
            <span className="text-xs text-muted-foreground">{scope.org ?? 'Personal account'}</span>
          </>
        }
        actions={
          <Button
            variant="outline"
            disabled={query.isFetching || messages.isFetching}
            onClick={() => {
              void query.refetch();
              void messages.refetch();
            }}
          >
            <RefreshDouble className="size-4" />
            Refresh
          </Button>
        }
      />
      <SupportReadState query={query} />
      {ticket && (
        <div className="mx-auto w-full max-w-4xl space-y-5">
          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="min-w-0 flex-1 text-xl font-medium break-words">{ticket.subject}</h2>
              <SupportStatus status={ticket.status} />
            </div>
            <details className="mt-4 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Conversation details</summary>
              <dl className="mt-3 grid gap-2 break-all">
                <div>
                  <dt className="inline font-medium">Ticket ID: </dt>
                  <dd className="inline">{ticket.id}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Opened: </dt>
                  <dd className="inline">{new Date(ticket.created_at).toLocaleString()}</dd>
                </div>
                {Object.entries(ticket.context)
                  .filter(([, value]) => value)
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt className="inline font-medium">
                        {key === 'app_id'
                          ? 'App ID'
                          : key === 'deployment_id'
                            ? 'Deployment ID'
                            : 'Request ID'}
                        :{' '}
                      </dt>
                      <dd className="inline">{value}</dd>
                    </div>
                  ))}
              </dl>
            </details>
          </Panel>
          <Panel title="Conversation">
            <SupportReadState query={messages} />
            <ol className="divide-y divide-border">
              {pages
                ?.flatMap((page) => page.items)
                .map((message) => (
                  <li key={message.id} className="py-5 first:pt-2">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span
                        className={
                          message.author === 'staff' ? 'font-medium text-brand' : 'font-medium'
                        }
                      >
                        {message.author === 'staff' ? 'Gregale support' : 'Customer'}
                      </span>
                      <time dateTime={message.created_at} className="text-muted-foreground">
                        {new Date(message.created_at).toLocaleString()}
                      </time>
                    </div>
                    <p
                      className={`text-sm leading-7 whitespace-pre-wrap [overflow-wrap:anywhere] ${message.redacted ? 'text-muted-foreground italic' : ''}`}
                    >
                      {message.redacted ? 'This message was removed after review.' : message.body}
                    </p>
                  </li>
                ))}
            </ol>
            {messages.hasNextPage && (
              <Button
                variant="outline"
                disabled={messages.isFetchingNextPage}
                onClick={() => void messages.fetchNextPage()}
              >
                Read more messages
              </Button>
            )}
            {read.error && allRead && (
              <p role="status" className="mt-4 text-xs text-muted-foreground">
                Unread updates could not be cleared.{' '}
                <button
                  type="button"
                  className="text-brand underline"
                  disabled={read.isPending}
                  onClick={() => read.mutate(through)}
                >
                  Mark conversation read
                </button>
              </p>
            )}
          </Panel>
          <SupportReply scope={scope} ticket={ticket} unavailable={Boolean(query.error)} />
          {ticket.status === 'resolved' && <SupportRating scope={scope} ticket={id} />}
        </div>
      )}
    </div>
  );
}

export function SupportReply({
  scope,
  ticket,
  unavailable = false,
}: {
  scope: SupportScope;
  ticket: SupportTicket;
  unavailable?: boolean;
}) {
  const write = useSupportWrite(scope);
  const confirm = useConfirm();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  const resolved = ticket.status === 'resolved';
  const canReply = !resolved || ticket.can_reopen;
  const success = () => {
    setBody('');
    setSent(true);
  };
  return (
    <Panel title={resolved ? 'Resolution' : 'Your reply'}>
      {resolved && (
        <p className="mb-4 text-sm text-muted-foreground">
          {ticket.can_reopen
            ? `This conversation is resolved. Tell us what still needs help to reopen it${ticket.reopen_until ? ` before ${new Date(ticket.reopen_until).toLocaleString()}` : ''}.`
            : 'This conversation is resolved and can no longer be reopened. Start a new conversation if you need more help.'}
        </p>
      )}
      {(canReply || write.locked) && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (write.locked || unavailable) return;
            const invalid = supportTextError(body, 10_000, 'A message');
            if (invalid) {
              setError(invalid);
              return;
            }
            setError(undefined);
            setSent(false);
            void write
              .run({
                kind: resolved ? 'reopen' : 'reply',
                ticket: ticket.id,
                body: { expected_revision: ticket.revision, body },
              })
              .then(success)
              .catch(() => {});
          }}
        >
          <label className="block space-y-2 text-sm">
            <span>{resolved ? 'What still needs help?' : 'Message'}</span>
            <Textarea
              rows={5}
              value={body}
              disabled={write.locked || unavailable}
              onChange={(e) => {
                setBody(e.target.value);
                setSent(false);
              }}
              required
              aria-describedby={error ? 'support-reply-error' : 'support-reply-help'}
            />
          </label>
          <p id="support-reply-help" className="text-xs text-muted-foreground">
            Keep passwords, API keys, and private logs out of your message.
          </p>
          {error && <FieldError id="support-reply-error">{error}</FieldError>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={write.locked || unavailable}>
              {write.isPending ? 'Sending…' : resolved ? 'Reopen conversation' : 'Send reply'}
            </Button>
            {!resolved && (
              <Button
                type="button"
                variant="outline"
                disabled={write.locked || unavailable}
                onClick={async () => {
                  if (
                    !(await confirm({
                      title: 'Mark this conversation resolved?',
                      description:
                        'Use this when you no longer need help. You can reopen it only within the support policy’s allowance.',
                      confirmLabel: 'Mark resolved',
                    }))
                  )
                    return;
                  setSent(false);
                  void write
                    .run({
                      kind: 'close',
                      ticket: ticket.id,
                      body: { expected_revision: ticket.revision },
                    })
                    .then(success)
                    .catch(() => {});
                }}
              >
                Mark resolved
              </Button>
            )}
          </div>
        </form>
      )}
      {sent && (
        <p role="status" className="mt-3 text-sm text-brand">
          Saved. The conversation is updating.
        </p>
      )}
      <div className="mt-3">
        <SupportWriteError write={write} onSuccess={success} />
      </div>
      {resolved && !canReply && (
        <SupportLink org={scope.org} className="text-sm text-brand underline">
          Back to support
        </SupportLink>
      )}
    </Panel>
  );
}

export function SupportRating({ scope, ticket }: { scope: SupportScope; ticket: string }) {
  const survey = useSupportSurvey(scope, ticket);
  const write = useSupportWrite(scope);
  const [rating, setRating] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  return (
    <Panel title="How did we do?">
      <SupportReadState query={survey} />
      {survey.data?.rating || submitted ? (
        <p role="status" className="text-sm text-muted-foreground">
          Thanks for your feedback
          {survey.data?.rating ? ` — you rated this resolution ${survey.data.rating} out of 5` : ''}
          .
        </p>
      ) : survey.data?.eligible ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (write.locked || !rating || !survey.data) return;
            void write
              .run({ kind: 'rate', ticket, body: { episode_id: survey.data.episode_id, rating } })
              .then(() => setSubmitted(true))
              .catch(() => {});
          }}
        >
          <fieldset disabled={write.locked}>
            <legend className="mb-3 text-sm">Rate this resolution</legend>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((value) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm"
                >
                  <input
                    type="radio"
                    name="support-rating"
                    value={value}
                    checked={rating === value}
                    onChange={() => setRating(value)}
                  />
                  {value}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              1 — Very dissatisfied · 5 — Very satisfied
            </p>
          </fieldset>
          <Button type="submit" disabled={!rating || write.locked}>
            Send rating
          </Button>
        </form>
      ) : survey.data ? (
        <p className="text-sm text-muted-foreground">
          A rating is not available for this resolution.
        </p>
      ) : null}
      <div className="mt-3">
        <SupportWriteError write={write} onSuccess={() => setSubmitted(true)} />
      </div>
    </Panel>
  );
}
