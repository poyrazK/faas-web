import { describe, expect, it } from 'vitest';
import type { components } from '@/lib/api/schema';
import {
  allowedBrokerKinds,
  buildCreateTriggerRequest,
  buildUpdateTriggerRequest,
  clearTriggerSecrets,
  draftFromTrigger,
  newTriggerDraft,
  validateTriggerDraft,
  withSourceKind,
  type TriggerLimits,
} from './trigger-form-model';

const hobbyLimits = {
  triggers_allowed: true,
  trigger_kinds: ['sqs_compat', 'queue'],
  trigger_batch_size_max: 50,
  trigger_batch_window_max_ms: 30_000,
  trigger_max_attempts_max: 3,
  trigger_payload_max_bytes: 1_048_576,
  trigger_tls_skip_verify_allowed: false,
} as TriggerLimits;

const proLimits = {
  triggers_allowed: true,
  trigger_kinds: ['kafka', 'nats', 'redis_streams', 'sqs_compat', 'queue'],
  trigger_batch_size_max: 500,
  trigger_batch_window_max_ms: 300_000,
  trigger_max_attempts_max: 10,
  trigger_payload_max_bytes: 6_291_456,
  trigger_tls_skip_verify_allowed: true,
} as TriggerLimits;

describe('trigger form model', () => {
  it('uses the account snapshot for allowed kinds and plan-safe defaults', () => {
    const draft = newTriggerDraft(hobbyLimits, 'app-1');
    // sqs_compat is refused by apid (faas d69c41b965), so it is never offered.
    expect(allowedBrokerKinds(hobbyLimits)).toEqual(['queue']);
    expect(draft.source.kind).toBe('queue');
    expect(draft.delivery).toMatchObject({
      batchSizeMax: 50,
      batchWindowMs: 1000,
      maxAttempts: 3,
      payloadMaxBytes: 1_048_576,
      enabled: true,
    });
    expect(allowedBrokerKinds({ ...hobbyLimits, triggers_allowed: false })).toEqual([]);
    expect(allowedBrokerKinds(proLimits)).toEqual(['kafka', 'nats', 'redis_streams', 'queue']);
  });

  it('emits the exact Kafka SASL and TLS vocabulary', () => {
    const draft = newTriggerDraft(proLimits, 'app-1');
    draft.slug = 'orders';
    draft.source = {
      kind: 'kafka',
      brokers: 'a:9092, b:9092',
      topic: 'orders',
      group: 'gregale',
      tlsEnabled: true,
      caCert: 'ca',
      clientCert: 'cert',
      clientKey: 'key',
      clientKeySet: false,
      skipVerify: true,
      saslEnabled: true,
      mechanism: 'SCRAM-SHA-256',
      username: 'svc',
      password: 'pw',
      passwordSet: false,
    };
    expect(buildCreateTriggerRequest(draft).config).toEqual({
      brokers: ['a:9092', 'b:9092'],
      topic: 'orders',
      group: 'gregale',
      tls: { ca_cert: 'ca', client_cert: 'cert', client_key: 'key', skip_verify: true },
      sasl: { mechanism: 'SCRAM-SHA-256', username: 'svc', password: 'pw' },
    });
  });

  it('validates required source fields, TLS pairs, filters, and plan caps', () => {
    const draft = newTriggerDraft(proLimits, '');
    draft.source = {
      kind: 'kafka',
      brokers: '',
      topic: '',
      group: '',
      tlsEnabled: true,
      caCert: '',
      clientCert: 'cert',
      clientKey: '',
      clientKeySet: false,
      skipVerify: false,
      saslEnabled: true,
      mechanism: 'PLAIN',
      username: '',
      password: '',
      passwordSet: false,
    };
    draft.delivery.batchSizeMax = 501;
    draft.delivery.batchWindowMs = 9;
    draft.delivery.maxAttempts = 0;
    draft.delivery.payloadMaxBytes = 1023;
    draft.filterCriteriaText = '{bad';
    expect(validateTriggerDraft(draft)).toMatchObject({
      appId: expect.any(String),
      slug: expect.any(String),
      brokers: expect.any(String),
      topic: expect.any(String),
      group: expect.any(String),
      clientKey: expect.any(String),
      username: expect.any(String),
      password: expect.any(String),
      batchSizeMax: expect.any(String),
      batchWindowMs: expect.any(String),
      maxAttempts: expect.any(String),
      payloadMaxBytes: expect.any(String),
      filterCriteriaText: expect.any(String),
    });
  });

  it('rejects TLS skip verify when the account does not allow it', () => {
    const draft = newTriggerDraft(hobbyLimits, 'app-1');
    draft.slug = 'orders';
    draft.source = {
      kind: 'kafka',
      brokers: 'b:9092',
      topic: 'orders',
      group: 'gregale',
      tlsEnabled: true,
      caCert: '',
      clientCert: '',
      clientKey: '',
      clientKeySet: false,
      skipVerify: true,
      saslEnabled: false,
      mechanism: 'PLAIN',
      username: '',
      password: '',
      passwordSet: false,
    };
    expect(validateTriggerDraft(draft).skipVerify).toMatch(/plan/i);
  });

  it('converts SQS numbers, queue mode, filters, and explicit delivery values', () => {
    const draft = newTriggerDraft(hobbyLimits, 'app-1');
    draft.slug = 'inbound';
    draft.source = {
      kind: 'sqs_compat',
      queueUrl: 'https://sqs.example.test/queue',
      longPollSecs: '12',
    };
    draft.filterCriteriaText = '{"path":"$.type","equals":"order"}';
    expect(buildCreateTriggerRequest(draft)).toMatchObject({
      app_id: 'app-1',
      kind: 'sqs_compat',
      slug: 'inbound',
      config: { queue_url: 'https://sqs.example.test/queue', long_poll_secs: 12 },
      batch_size_max: 50,
      batch_window_ms: 1000,
      max_attempts: 3,
      payload_max_bytes: 1_048_576,
      enabled: true,
      filter_criteria: { path: '$.type', equals: 'order' },
    });
    draft.source = { kind: 'queue', mode: 'delayed_task' };
    expect(buildCreateTriggerRequest(draft).config).toEqual({ mode: 'delayed_task' });
  });

  it('normalizes redacted Kafka config and preserves credentials on update', () => {
    const trigger = {
      id: 't-1',
      account_id: 'acct',
      app_id: 'app-1',
      kind: 'kafka',
      slug: 'orders',
      enabled: true,
      config: {
        brokers: ['b:9092'],
        topic: 'orders',
        group: 'gregale',
        sasl: { mechanism: 'SCRAM-SHA-512', username: 'svc', password_set: true },
        tls: { client_cert: 'cert', client_key_set: true, skip_verify: false },
      },
      batch_size_max: 64,
      batch_window_ms: 1000,
      max_attempts: 5,
      payload_max_bytes: 6_291_456,
      broker_poison_strategy: 'commit',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    } as unknown as components['schemas']['Trigger'];
    const draft = draftFromTrigger(trigger, proLimits);
    expect(draft.source).toMatchObject({ password: '', passwordSet: true, clientKeySet: true });
    expect(buildUpdateTriggerRequest(draft, trigger).config).toMatchObject({
      sasl: { mechanism: 'SCRAM-SHA-512', username: 'svc' },
      tls: { client_cert: 'cert', skip_verify: false },
    });
    if (draft.source.kind !== 'kafka') throw new Error('expected kafka');
    draft.source.password = 'rotated';
    draft.source.clientKey = 'rotated-key';
    expect(buildUpdateTriggerRequest(draft, trigger).config).toMatchObject({
      sasl: { password: 'rotated' },
      tls: { client_key: 'rotated-key' },
    });
  });

  it('removes whole SASL and TLS blocks and clears in-memory secrets', () => {
    const trigger = {
      app_id: 'app-1',
      kind: 'kafka',
      slug: 'orders',
      enabled: true,
      config: { brokers: ['b:9092'], topic: 'orders', group: 'g' },
      batch_size_max: 64,
      batch_window_ms: 1000,
      max_attempts: 5,
      payload_max_bytes: 6_291_456,
      broker_poison_strategy: 'commit',
    } as unknown as components['schemas']['Trigger'];
    const draft = draftFromTrigger(trigger, proLimits);
    if (draft.source.kind !== 'kafka') throw new Error('expected kafka');
    draft.source.saslEnabled = false;
    draft.source.tlsEnabled = false;
    draft.source.password = 'pw';
    draft.source.clientKey = 'key';
    const update = buildUpdateTriggerRequest(draft, trigger);
    expect(update.config).not.toHaveProperty('sasl');
    expect(update.config).not.toHaveProperty('tls');
    expect(clearTriggerSecrets(draft).source).toMatchObject({ password: '', clientKey: '' });
  });
});

describe('creatable trigger kinds', () => {
  const limits = {
    ...proLimits,
    trigger_kinds: ['kafka', 'sqs_compat', 'realtime', 'queue'],
  } as unknown as TriggerLimits;

  it('never offers sqs_compat, even if a plan lists it', () => {
    // apid refuses sqs_compat with 422 trigger_kind_unavailable since faas d69c41b965.
    expect(allowedBrokerKinds(limits, { realtime: true })).not.toContain('sqs_compat');
  });

  it('offers realtime only while the realtime capability is on', () => {
    // Outside the realtime preview apid answers kind=realtime as unknown.
    expect(allowedBrokerKinds(limits)).toEqual(['kafka', 'queue']);
    expect(allowedBrokerKinds(limits, { realtime: false })).toEqual(['kafka', 'queue']);
    expect(allowedBrokerKinds(limits, { realtime: true })).toEqual(['kafka', 'realtime', 'queue']);
  });
});

describe('delivery mode', () => {
  it('defaults to per-record delivery and sends the chosen mode', () => {
    const draft = newTriggerDraft(proLimits, 'app-1');
    expect(draft.delivery.mode).toBe('record');
    draft.slug = 'orders';
    draft.source = { ...draft.source, brokers: 'b:9092', topic: 't', group: 'g' } as never;
    expect(buildCreateTriggerRequest(draft).delivery).toBe('record');
    draft.delivery.mode = 'batch';
    expect(buildCreateTriggerRequest(draft).delivery).toBe('batch');
  });

  it('never sends batch delivery for a queue trigger', () => {
    // api.ValidateTriggerDelivery refuses batch for cron and queue.
    let draft = newTriggerDraft(proLimits, 'app-1');
    draft.delivery.mode = 'batch';
    draft = withSourceKind(draft, 'queue');
    expect(draft.delivery.mode).toBe('record');
    expect(buildCreateTriggerRequest(draft)).not.toHaveProperty('delivery');
  });

  it('reads the delivery mode back from a trigger', () => {
    const trigger = {
      app_id: 'app-1',
      kind: 'nats',
      slug: 'n',
      enabled: true,
      delivery: 'batch',
      config: { url: 'nats://n:4222', stream: 's', subject: 'x', durable: 'd' },
      batch_size_max: 64,
      batch_window_ms: 1000,
      max_attempts: 5,
      payload_max_bytes: 6_291_456,
      broker_poison_strategy: 'commit',
    } as unknown as components['schemas']['Trigger'];
    const draft = draftFromTrigger(trigger, proLimits);
    expect(draft.delivery.mode).toBe('batch');
    expect(buildUpdateTriggerRequest(draft, trigger).delivery).toBe('batch');
  });
});

describe('realtime triggers', () => {
  const endpoint = '7b0c1f9e-2d4a-4c8e-9f31-5a6b7c8d9e0f';
  const realtimeLimits = { ...proLimits, trigger_kinds: ['realtime', 'queue'] } as TriggerLimits;

  function realtimeDraft() {
    const draft = withSourceKind(newTriggerDraft(realtimeLimits, 'app-1'), 'realtime');
    draft.slug = 'chat';
    draft.source = {
      kind: 'realtime',
      endpointId: endpoint,
      channel: 'orders',
      group: 'billing',
      maxConcurrency: 4,
    };
    return draft;
  }

  it('sends only the fields the trigger owns, one message per record invocation', () => {
    // managedrealtime/triggers.go rejects batch_window_ms, max_attempts,
    // retry_policy, broker_poison_strategy and filter_criteria.
    const body = buildCreateTriggerRequest(realtimeDraft());
    expect(body).toEqual({
      app_id: 'app-1',
      kind: 'realtime',
      slug: 'chat',
      config: { endpoint_id: endpoint, channel: 'orders', group: 'billing', max_concurrency: 4 },
      delivery: 'record',
      batch_size_max: 1,
      enabled: true,
    });
  });

  it('carries messages per invocation only with batch delivery, at most 16', () => {
    const draft = realtimeDraft();
    expect(draft.delivery.batchSizeMax).toBe(10);
    draft.delivery.mode = 'batch';
    expect(validateTriggerDraft(draft)).toEqual({});
    expect(buildCreateTriggerRequest(draft)).toMatchObject({
      delivery: 'batch',
      batch_size_max: 10,
    });
    draft.delivery.batchSizeMax = 17;
    expect(validateTriggerDraft(draft).batchSizeMax).toMatch(/1 to 16/);
  });

  it('validates the binding and omits a zero concurrency', () => {
    const draft = realtimeDraft();
    draft.source = {
      kind: 'realtime',
      endpointId: 'nope',
      channel: '',
      group: '',
      maxConcurrency: 40,
    };
    expect(Object.keys(validateTriggerDraft(draft)).sort()).toEqual([
      'channel',
      'endpointId',
      'group',
      'maxConcurrency',
    ]);
    draft.source = { ...realtimeDraft().source, maxConcurrency: 0 } as never;
    expect(buildCreateTriggerRequest(draft).config).not.toHaveProperty('max_concurrency');
  });

  it('round-trips a saved trigger and patches without group-owned fields', () => {
    const trigger = {
      app_id: 'app-1',
      kind: 'realtime',
      slug: 'chat',
      enabled: true,
      delivery: 'batch',
      config: { endpoint_id: endpoint, channel: 'orders', group: 'billing', max_concurrency: 4 },
      batch_size_max: 12,
      batch_window_ms: 1000,
      max_attempts: 1,
      payload_max_bytes: 6_291_456,
      broker_poison_strategy: 'commit',
    } as unknown as components['schemas']['Trigger'];
    const draft = draftFromTrigger(trigger, realtimeLimits);
    expect(draft.source).toEqual({
      kind: 'realtime',
      endpointId: endpoint,
      channel: 'orders',
      group: 'billing',
      maxConcurrency: 4,
    });
    const patch = buildUpdateTriggerRequest(draft, trigger);
    expect(patch).toEqual({
      config: { endpoint_id: endpoint, channel: 'orders', group: 'billing', max_concurrency: 4 },
      delivery: 'batch',
      batch_size_max: 12,
      enabled: true,
    });
    // Switching to per-record must also bring the batch size back to 1.
    draft.delivery.mode = 'record';
    expect(buildUpdateTriggerRequest(draft, trigger)).toMatchObject({
      delivery: 'record',
      batch_size_max: 1,
    });
  });
});
