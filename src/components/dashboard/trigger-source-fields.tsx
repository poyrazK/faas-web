import { useState, type ReactNode } from 'react';
import { NavArrowDown } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FieldError, Select, Textarea } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { TriggerLimits, TriggerSourceDraft } from './trigger-form-model';

function Field({
  label,
  error,
  children,
  hint,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = `trigger-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-error`;
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
      {error ? (
        <FieldError id={id}>{error}</FieldError>
      ) : hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export function TriggerSourceFields({
  source,
  errors,
  limits,
  onChange,
}: {
  source: TriggerSourceDraft;
  errors: Record<string, string>;
  limits: TriggerLimits;
  onChange: (source: TriggerSourceDraft) => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const patch = (values: Record<string, unknown>) =>
    onChange({ ...source, ...values } as TriggerSourceDraft);
  const invalid = (key: string) => Boolean(errors[key]) || undefined;

  if (source.kind === 'nats') {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="NATS URL" error={errors.url} hint="nats:// or tls:// with a host.">
          <Input
            aria-label="NATS URL"
            aria-invalid={invalid('url')}
            value={source.url}
            onChange={(event) => patch({ url: event.target.value })}
          />
        </Field>
        <Field label="Stream" error={errors.stream}>
          <Input
            aria-label="Stream"
            aria-invalid={invalid('stream')}
            value={source.stream}
            onChange={(event) => patch({ stream: event.target.value })}
          />
        </Field>
        <Field label="Subject" error={errors.subject}>
          <Input
            aria-label="Subject"
            aria-invalid={invalid('subject')}
            value={source.subject}
            onChange={(event) => patch({ subject: event.target.value })}
          />
        </Field>
        <Field label="Durable name" error={errors.durable}>
          <Input
            aria-label="Durable name"
            aria-invalid={invalid('durable')}
            value={source.durable}
            onChange={(event) => patch({ durable: event.target.value })}
          />
        </Field>
      </div>
    );
  }

  if (source.kind === 'redis_streams') {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Redis address" error={errors.addr} hint="host:port">
          <Input
            aria-label="Redis address"
            aria-invalid={invalid('addr')}
            value={source.addr}
            onChange={(event) => patch({ addr: event.target.value })}
          />
        </Field>
        <Field label="Stream" error={errors.stream}>
          <Input
            aria-label="Stream"
            aria-invalid={invalid('stream')}
            value={source.stream}
            onChange={(event) => patch({ stream: event.target.value })}
          />
        </Field>
        <Field label="Consumer group" error={errors.group}>
          <Input
            aria-label="Consumer group"
            aria-invalid={invalid('group')}
            value={source.group}
            onChange={(event) => patch({ group: event.target.value })}
          />
        </Field>
      </div>
    );
  }

  if (source.kind === 'sqs_compat') {
    return (
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <Field label="Queue URL" error={errors.queueUrl} hint="An http:// or https:// endpoint.">
          <Input
            aria-label="Queue URL"
            aria-invalid={invalid('queueUrl')}
            value={source.queueUrl}
            onChange={(event) => patch({ queueUrl: event.target.value })}
          />
        </Field>
        <Field label="Long poll (seconds)" error={errors.longPollSecs} hint="Optional, 1–20.">
          <Input
            type="number"
            min={1}
            max={20}
            aria-label="Long poll (seconds)"
            aria-invalid={invalid('longPollSecs')}
            value={source.longPollSecs}
            onChange={(event) => patch({ longPollSecs: event.target.value })}
          />
        </Field>
      </div>
    );
  }

  if (source.kind === 'queue') {
    return (
      <Field label="Queue mode" error={errors.mode}>
        <Select
          aria-label="Queue mode"
          className="w-full sm:w-64"
          value={source.mode}
          onChange={(event) => patch({ mode: event.target.value })}
        >
          <option value="queue">Queue messages</option>
          <option value="delayed_task">Delayed tasks</option>
        </Select>
      </Field>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Brokers" error={errors.brokers} hint="Comma-separated host:port values.">
          <Input
            aria-label="Brokers"
            aria-invalid={invalid('brokers')}
            value={source.brokers}
            onChange={(event) => patch({ brokers: event.target.value })}
          />
        </Field>
        <Field label="Topic" error={errors.topic}>
          <Input
            aria-label="Topic"
            aria-invalid={invalid('topic')}
            value={source.topic}
            onChange={(event) => patch({ topic: event.target.value })}
          />
        </Field>
        <Field label="Consumer group" error={errors.group}>
          <Input
            aria-label="Consumer group"
            aria-invalid={invalid('group')}
            value={source.group}
            onChange={(event) => patch({ group: event.target.value })}
          />
        </Field>
      </div>

      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="w-fit"
        aria-expanded={advanced}
        onClick={() => setAdvanced((value) => !value)}
      >
        TLS and SASL
        <NavArrowDown className={cn('transition-transform', advanced && 'rotate-180')} />
      </Button>

      {advanced && (
        <div className="grid gap-5 border-l border-border pl-4 lg:grid-cols-2">
          <section className="flex flex-col gap-4" aria-labelledby="trigger-tls-heading">
            <div className="flex items-center justify-between gap-3">
              <h3 id="trigger-tls-heading" className="label-mono text-muted-foreground">
                Transport security
              </h3>
              <Switch
                checked={source.tlsEnabled}
                onCheckedChange={(checked) => patch({ tlsEnabled: checked })}
                aria-label="Use TLS"
              />
            </div>
            {source.tlsEnabled && (
              <>
                <Field label="CA certificate" error={errors.caCert} hint="Optional PEM bundle.">
                  <Textarea
                    aria-label="CA certificate"
                    aria-invalid={invalid('caCert')}
                    value={source.caCert}
                    onChange={(event) => patch({ caCert: event.target.value })}
                  />
                </Field>
                <Field label="Client certificate" error={errors.clientCert} hint="PEM, for mTLS.">
                  <Textarea
                    aria-label="Client certificate"
                    aria-invalid={invalid('clientCert')}
                    value={source.clientCert}
                    onChange={(event) => patch({ clientCert: event.target.value })}
                  />
                </Field>
                <Field
                  label="Client key"
                  error={errors.clientKey}
                  hint={
                    source.clientKeySet ? 'A client key is already configured.' : 'PEM, for mTLS.'
                  }
                >
                  <Input
                    type="password"
                    aria-label="Client key"
                    aria-invalid={invalid('clientKey')}
                    value={source.clientKey}
                    onChange={(event) => patch({ clientKey: event.target.value })}
                    autoComplete="new-password"
                  />
                </Field>
                {limits.trigger_tls_skip_verify_allowed && (
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>Skip TLS verification</span>
                    <Switch
                      checked={source.skipVerify}
                      onCheckedChange={(checked) => patch({ skipVerify: checked })}
                      aria-label="Skip TLS verification"
                      aria-invalid={invalid('skipVerify')}
                    />
                  </label>
                )}
                {errors.skipVerify && (
                  <FieldError id="trigger-skip-verify-error">{errors.skipVerify}</FieldError>
                )}
              </>
            )}
          </section>

          <section className="flex flex-col gap-4" aria-labelledby="trigger-sasl-heading">
            <div className="flex items-center justify-between gap-3">
              <h3 id="trigger-sasl-heading" className="label-mono text-muted-foreground">
                Authentication
              </h3>
              <Switch
                checked={source.saslEnabled}
                onCheckedChange={(checked) => patch({ saslEnabled: checked })}
                aria-label="Use SASL"
              />
            </div>
            {source.saslEnabled && (
              <>
                <Field label="SASL mechanism" error={errors.mechanism}>
                  <Select
                    aria-label="SASL mechanism"
                    value={source.mechanism}
                    onChange={(event) => patch({ mechanism: event.target.value })}
                  >
                    <option value="PLAIN">PLAIN</option>
                    <option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
                    <option value="SCRAM-SHA-512">SCRAM-SHA-512</option>
                  </Select>
                </Field>
                <Field label="SASL username" error={errors.username}>
                  <Input
                    aria-label="SASL username"
                    aria-invalid={invalid('username')}
                    value={source.username}
                    onChange={(event) => patch({ username: event.target.value })}
                  />
                </Field>
                <Field
                  label="SASL password"
                  error={errors.password}
                  hint={source.passwordSet ? 'A password is already configured.' : 'Write-only.'}
                >
                  <Input
                    type="password"
                    autoComplete="new-password"
                    aria-label="SASL password"
                    aria-invalid={invalid('password')}
                    value={source.password}
                    onChange={(event) => patch({ password: event.target.value })}
                  />
                </Field>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
