import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Plus } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD, FieldError, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { Panel } from '@/components/dashboard/primitives';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useApps, useCreateTrigger } from '@/lib/api/queries';
import { cn } from '@/lib/utils';

/**
 * Create a broker trigger.
 *
 * **Cron is deliberately absent.** `POST /v1/triggers` refuses `kind=cron`
 * outright — the handler answers 400 with "use POST /v1/crons" — so offering
 * it here would build a form whose only outcome is an error. The Crons page
 * already creates them, and this panel links there.
 *
 * The five broker kinds each require a `slug` and a non-empty `config`, and
 * the server validates the config per kind. The required fields are known, so
 * this asks for them by name rather than for a blob of JSON: a customer who
 * has to hand-write `{"brokers":[…],"topic":…,"group":…}` is doing the
 * server's schema in their head. What the server would reject is caught here
 * where possible, and what it rejects anyway is shown in its own words —
 * `trigger_invalid_config` carries the exact reason (empty topic, bad URL
 * scheme, a mode outside the closed set).
 *
 * Credentials go where every other credential in the console goes: to the API
 * over the session, sealed server-side. The console never holds them to talk
 * to a broker itself.
 */

type BrokerKind = 'kafka' | 'nats' | 'redis_streams' | 'sqs_compat' | 'queue';

const KINDS: { value: BrokerKind; label: string; blurb: string }[] = [
  { value: 'kafka', label: 'Kafka', blurb: 'Consume a topic as a consumer group.' },
  { value: 'nats', label: 'NATS JetStream', blurb: 'A durable consumer on a stream subject.' },
  { value: 'redis_streams', label: 'Redis Streams', blurb: 'A consumer group on a stream.' },
  { value: 'sqs_compat', label: 'SQS-compatible', blurb: 'Long-poll an SQS-compatible queue URL.' },
  { value: 'queue', label: 'Platform queue', blurb: "Gregale's own queue or delayed tasks." },
];

/** The server's per-kind rules, applied here so the obvious mistakes never leave the browser. */
export function validateConfig(
  kind: BrokerKind,
  c: Record<string, string>
): Record<string, string> {
  const e: Record<string, string> = {};
  const need = (k: string, msg: string) => {
    if (!c[k]?.trim()) e[k] = msg;
  };
  if (kind === 'kafka') {
    need('brokers', 'At least one broker, comma-separated.');
    need('topic', 'The topic to consume.');
    need('group', 'The consumer group.');
  }
  if (kind === 'nats') {
    need('url', 'A nats:// or tls:// URL.');
    if (c.url?.trim() && !/^(nats|tls):\/\/[^/\s]+/.test(c.url.trim()))
      e.url = 'Must be nats:// or tls:// with a host.';
    need('stream', 'The stream name.');
    need('subject', 'The subject to bind.');
    need('durable', 'A durable consumer name.');
  }
  if (kind === 'redis_streams') {
    need('addr', 'host:port of the Redis server.');
    need('stream', 'The stream key.');
    need('group', 'The consumer group.');
  }
  if (kind === 'sqs_compat') {
    need('queue_url', 'The queue URL.');
    if (c.queue_url?.trim() && !/^https?:\/\/[^/\s]+/.test(c.queue_url.trim()))
      e.queue_url = 'Must be http:// or https:// with a host.';
    const poll = c.long_poll_secs?.trim();
    if (poll && !(Number(poll) >= 1 && Number(poll) <= 20))
      e.long_poll_secs = 'Between 1 and 20 seconds, or leave empty.';
  }
  return e;
}

/** Shapes the typed fields into the per-kind config the API validates. */
export function buildConfig(kind: BrokerKind, c: Record<string, string>): Record<string, unknown> {
  const s = (k: string) => c[k]?.trim() ?? '';
  switch (kind) {
    case 'kafka': {
      const config: Record<string, unknown> = {
        brokers: s('brokers')
          .split(',')
          .map((b) => b.trim())
          .filter(Boolean),
        topic: s('topic'),
        group: s('group'),
      };
      if (s('sasl_username') || s('sasl_password'))
        config.sasl = {
          mechanism: s('sasl_mechanism') || 'scram-sha-256',
          username: s('sasl_username'),
          password: s('sasl_password'),
        };
      return config;
    }
    case 'nats':
      return { url: s('url'), stream: s('stream'), subject: s('subject'), durable: s('durable') };
    case 'redis_streams':
      return { addr: s('addr'), stream: s('stream'), group: s('group') };
    case 'sqs_compat':
      return {
        queue_url: s('queue_url'),
        ...(s('long_poll_secs') ? { long_poll_secs: Number(s('long_poll_secs')) } : {}),
      };
    case 'queue':
      return { mode: s('mode') || 'queue' };
  }
}

const FIELDS: Record<
  BrokerKind,
  { key: string; label: string; hint?: string; secret?: boolean }[]
> = {
  kafka: [
    { key: 'brokers', label: 'Brokers', hint: 'Comma-separated host:port list.' },
    { key: 'topic', label: 'Topic' },
    { key: 'group', label: 'Consumer group' },
    { key: 'sasl_username', label: 'SASL username', hint: 'Optional; leave empty for no SASL.' },
    { key: 'sasl_password', label: 'SASL password', secret: true },
  ],
  nats: [
    { key: 'url', label: 'URL', hint: 'nats:// or tls:// with a host.' },
    { key: 'stream', label: 'Stream' },
    { key: 'subject', label: 'Subject' },
    { key: 'durable', label: 'Durable name' },
  ],
  redis_streams: [
    { key: 'addr', label: 'Address', hint: 'host:port' },
    { key: 'stream', label: 'Stream' },
    { key: 'group', label: 'Consumer group' },
  ],
  sqs_compat: [
    { key: 'queue_url', label: 'Queue URL', hint: 'http:// or https://' },
    { key: 'long_poll_secs', label: 'Long poll (seconds)', hint: 'Optional, 1–20.' },
  ],
  queue: [],
};

export function CreateTrigger() {
  const { toast } = useToast();
  const apps = useApps();
  const create = useCreateTrigger();
  const [kind, setKind] = useState<BrokerKind>('kafka');
  const [appId, setAppId] = useState('');
  const [slug, setSlug] = useState('');
  const [config, setConfig] = useState<Record<string, string>>({ mode: 'queue' });
  const [touched, setTouched] = useState(false);

  const appList = apps.data ?? [];
  const chosenApp = appId || appList[0]?.id || '';
  const configErrors = validateConfig(kind, config);
  const slugOk = /^[a-z0-9][a-z0-9-]*$/.test(slug.trim());
  const ready = Boolean(chosenApp) && slugOk && Object.keys(configErrors).length === 0;
  const set = (k: string, v: string) => setConfig((c) => ({ ...c, [k]: v }));

  const submit = async () => {
    setTouched(true);
    if (!ready) return;
    try {
      const trigger = await create.mutateAsync({
        app_id: chosenApp,
        kind,
        slug: slug.trim(),
        config: buildConfig(kind, config),
      });
      setSlug('');
      toast({
        kind: 'success',
        title: `Trigger ${trigger.slug ?? slug.trim()} created`,
        description: 'It starts consuming once the platform picks up the change.',
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'trigger_quota_exceeded') {
        toast({ kind: 'info', title: 'Trigger limit reached', description: errorMessage(err) });
        return;
      }
      if (err instanceof ApiError && err.code === 'trigger_invalid_config') {
        // The server names the exact field it rejected; repeating it verbatim
        // beats "invalid configuration".
        toast({
          kind: 'error',
          title: 'The broker rejected that config',
          description: errorMessage(err),
        });
        return;
      }
      if (err instanceof ApiError && err.code === 'trigger_immutable') {
        toast({
          kind: 'info',
          title: 'Not created here',
          description: errorMessage(err),
        });
        return;
      }
      toast({
        kind: 'error',
        title: 'Could not create the trigger',
        description: errorMessage(err),
      });
    }
  };

  return (
    <Panel
      title="New trigger"
      description="Bind an event source to an app. The source's settings are validated by the platform before the trigger starts."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!create.isPending) void submit();
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Source</span>
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as BrokerKind)}
              aria-label="Trigger kind"
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">App</span>
            <Select
              value={chosenApp}
              onChange={(e) => setAppId(e.target.value)}
              aria-label="App to invoke"
            >
              {appList.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.slug}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Slug</span>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="orders-inbound"
              aria-label="Trigger slug"
              aria-invalid={(touched && !slugOk) || undefined}
              className={cn(FIELD, 'w-48')}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          {KINDS.find((k) => k.value === kind)?.blurb}
        </p>
        {touched && !slugOk && (
          <FieldError id="trigger-slug-error">
            A slug is required: lower-case letters, digits and dashes.
          </FieldError>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {kind === 'queue' ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Mode</span>
              <Select
                value={config.mode ?? 'queue'}
                onChange={(e) => set('mode', e.target.value)}
                aria-label="Queue mode"
              >
                <option value="queue">Queue messages</option>
                <option value="delayed_task">Delayed tasks</option>
              </Select>
            </label>
          ) : (
            FIELDS[kind].map((f) => (
              <label key={f.key} className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">{f.label}</span>
                <input
                  type={f.secret ? 'password' : 'text'}
                  autoComplete={f.secret ? 'new-password' : 'off'}
                  value={config[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  onBlur={() => setTouched(true)}
                  aria-label={f.label}
                  aria-invalid={(touched && Boolean(configErrors[f.key])) || undefined}
                  className={cn(FIELD, 'w-full')}
                />
                {touched && configErrors[f.key] ? (
                  <FieldError id={`trigger-${f.key}-error`}>{configErrors[f.key]}</FieldError>
                ) : (
                  f.hint && <span className="text-xs text-muted-foreground">{f.hint}</span>
                )}
              </label>
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" className="gap-1.5" busy={create.isPending}>
            <Plus className="h-3.5 w-3.5" />
            Create trigger
          </Button>
          <span className="text-xs text-muted-foreground">
            Scheduled runs are not triggers here —{' '}
            <Link to="/dashboard/crons" className="text-brand hover:underline">
              create a cron
            </Link>{' '}
            instead.
          </span>
        </div>
      </form>
    </Panel>
  );
}
