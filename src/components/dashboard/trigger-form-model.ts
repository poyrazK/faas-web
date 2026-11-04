import type { components } from '@/lib/api/schema';

type S = components['schemas'];

export type BrokerKind = Exclude<S['TriggerKind'], 'cron'>;
export type TriggerLimits = S['AccountResponse']['limits'];
export type KafkaMechanism = S['KafkaSASLMechanism'];

export type TriggerSourceDraft =
  | {
      kind: 'kafka';
      brokers: string;
      topic: string;
      group: string;
      tlsEnabled: boolean;
      caCert: string;
      clientCert: string;
      clientKey: string;
      clientKeySet: boolean;
      skipVerify: boolean;
      saslEnabled: boolean;
      mechanism: KafkaMechanism;
      username: string;
      password: string;
      passwordSet: boolean;
    }
  | { kind: 'nats'; url: string; stream: string; subject: string; durable: string }
  | { kind: 'redis_streams'; addr: string; stream: string; group: string }
  | { kind: 'sqs_compat'; queueUrl: string; longPollSecs: string }
  | { kind: 'queue'; mode: 'queue' | 'delayed_task' }
  | {
      kind: 'realtime';
      endpointId: string;
      channel: string;
      group: string;
      maxConcurrency: number;
    };

/** `record` invokes once per record; `batch` once per dispatch batch (faas ADR-1321). */
export type TriggerDeliveryMode = 'record' | 'batch';

export interface TriggerDeliveryDraft {
  mode: TriggerDeliveryMode;
  batchSizeMax: number;
  batchWindowMs: number;
  maxAttempts: number;
  payloadMaxBytes: number;
  poisonStrategy: 'commit' | 'seek-to-offset';
  enabled: boolean;
}

export interface TriggerDraft {
  appId: string;
  slug: string;
  source: TriggerSourceDraft;
  delivery: TriggerDeliveryDraft;
  filterCriteriaText: string;
  limits: TriggerLimits;
}

/**
 * Kinds the console creates. sqs_compat is refused (faas d69c41b965).
 * realtime exists only inside the realtime preview: outside it apid answers
 * the kind as unknown (managedrealtime/triggers.go PrepareRealtimeTrigger),
 * so the form offers it only while capability `realtime` is on.
 */
export type CreatableBrokerKind = Extract<
  BrokerKind,
  'kafka' | 'nats' | 'redis_streams' | 'queue' | 'realtime'
>;
const CREATABLE: CreatableBrokerKind[] = ['kafka', 'nats', 'redis_streams', 'queue', 'realtime'];

/** The most messages one batch-delivery realtime invocation receives (RealtimeConsumerGroupBatchMax). */
export const REALTIME_BATCH_MAX = 16;
/** apid's batch size for a batch-delivery realtime trigger (RealtimeTriggerDefaultBatchSize). */
export const REALTIME_BATCH_DEFAULT = 10;
/** Parallel invocations a realtime trigger may ask for (QueuePushDispatchSlotsPerNode). */
export const REALTIME_CONCURRENCY_MAX = 32;

/** Batch delivery is refused for cron and queue triggers (faas api.ValidateTriggerDelivery). */
export const supportsBatchDelivery = (kind: BrokerKind) => kind !== 'queue';

export function allowedBrokerKinds(
  limits: TriggerLimits,
  { realtime }: { realtime: boolean } = { realtime: false }
): CreatableBrokerKind[] {
  if (!limits.triggers_allowed) return [];
  return limits.trigger_kinds.filter(
    (kind): kind is CreatableBrokerKind =>
      CREATABLE.includes(kind as CreatableBrokerKind) && (kind !== 'realtime' || realtime)
  );
}

export function sourceDraft(kind: CreatableBrokerKind): TriggerSourceDraft {
  switch (kind) {
    case 'kafka':
      return {
        kind,
        brokers: '',
        topic: '',
        group: '',
        tlsEnabled: false,
        caCert: '',
        clientCert: '',
        clientKey: '',
        clientKeySet: false,
        skipVerify: false,
        saslEnabled: false,
        mechanism: 'SCRAM-SHA-256',
        username: '',
        password: '',
        passwordSet: false,
      };
    case 'nats':
      return { kind, url: '', stream: '', subject: '', durable: '' };
    case 'redis_streams':
      return { kind, addr: '', stream: '', group: '' };
    case 'queue':
      return { kind, mode: 'queue' };
    case 'realtime':
      return { kind, endpointId: '', channel: '', group: '', maxConcurrency: 0 };
  }
}

function defaultBatchSize(kind: BrokerKind, limits: TriggerLimits) {
  return kind === 'realtime' ? REALTIME_BATCH_DEFAULT : Math.min(64, limits.trigger_batch_size_max);
}

/**
 * Switches the draft's source kind. A realtime trigger's batch size means
 * messages per invocation (at most 16), and a queue trigger cannot batch, so
 * the delivery settings follow the kind rather than carrying a value the API
 * would refuse.
 */
export function withSourceKind(draft: TriggerDraft, kind: CreatableBrokerKind): TriggerDraft {
  const crossesRealtime = (draft.source.kind === 'realtime') !== (kind === 'realtime');
  return {
    ...draft,
    source: sourceDraft(kind),
    delivery: {
      ...draft.delivery,
      mode: supportsBatchDelivery(kind) ? draft.delivery.mode : 'record',
      batchSizeMax: crossesRealtime
        ? defaultBatchSize(kind, draft.limits)
        : draft.delivery.batchSizeMax,
    },
  };
}

export function newTriggerDraft(limits: TriggerLimits, appId: string): TriggerDraft {
  const kind = allowedBrokerKinds(limits)[0] ?? 'queue';
  return {
    appId,
    slug: '',
    source: sourceDraft(kind),
    delivery: {
      mode: 'record',
      batchSizeMax: defaultBatchSize(kind, limits),
      batchWindowMs: Math.min(1000, limits.trigger_batch_window_max_ms),
      maxAttempts: Math.min(5, limits.trigger_max_attempts_max),
      payloadMaxBytes: Math.min(6_291_456, limits.trigger_payload_max_bytes),
      poisonStrategy: 'commit',
      enabled: true,
    },
    filterCriteriaText: '',
    limits,
  };
}

const required = (value: string, message: string) => (value.trim() ? undefined : message);
// apid parses endpoint_id with uuid.Parse, which takes the dashed and the 32-hex forms.
const UUID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function parseFilter(text: string): S['FilterCriteria'] | undefined {
  if (!text.trim()) return undefined;
  const value: unknown = JSON.parse(text);
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Filter criteria must be a JSON object.');
  }
  return value as S['FilterCriteria'];
}

export function validateTriggerDraft(draft: TriggerDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  const put = (key: string, value: string | undefined) => {
    if (value) errors[key] = value;
  };

  put('appId', required(draft.appId, 'Choose the app this trigger invokes.'));
  if (!/^[a-z0-9][a-z0-9-]*$/.test(draft.slug.trim())) {
    errors.slug = 'Use lower-case letters, digits, and dashes.';
  }
  // The plan decides here; the realtime capability decides which kinds the form offers.
  const planKinds: string[] = allowedBrokerKinds(draft.limits, { realtime: true });
  if (!planKinds.includes(draft.source.kind)) {
    errors.kind = 'This source kind is not included in the current plan.';
  }

  const source = draft.source;
  if (source.kind === 'kafka') {
    put('brokers', required(source.brokers, 'Enter at least one broker.'));
    put('topic', required(source.topic, 'Enter the topic to consume.'));
    put('group', required(source.group, 'Enter the consumer group.'));
    if (source.tlsEnabled) {
      const hasCert = Boolean(source.clientCert.trim());
      const hasKey = Boolean(source.clientKey.trim() || source.clientKeySet);
      if (hasCert !== hasKey) {
        if (!hasCert) errors.clientCert = 'A client certificate is required with a client key.';
        if (!hasKey) errors.clientKey = 'A client key is required with a client certificate.';
      }
      if (source.skipVerify && !draft.limits.trigger_tls_skip_verify_allowed) {
        errors.skipVerify = 'TLS verification cannot be skipped on the current plan.';
      }
    }
    if (source.saslEnabled) {
      put('username', required(source.username, 'Enter the SASL username.'));
      if (!source.password.trim() && !source.passwordSet) {
        errors.password = 'Enter the SASL password.';
      }
    }
  } else if (source.kind === 'nats') {
    put('url', required(source.url, 'Enter the NATS URL.'));
    if (source.url.trim() && !/^(nats|tls):\/\/[^/\s]+/.test(source.url.trim())) {
      errors.url = 'Use a nats:// or tls:// URL with a host.';
    }
    put('stream', required(source.stream, 'Enter the stream name.'));
    put('subject', required(source.subject, 'Enter the subject.'));
    put('durable', required(source.durable, 'Enter a durable consumer name.'));
  } else if (source.kind === 'redis_streams') {
    put('addr', required(source.addr, 'Enter the Redis host and port.'));
    put('stream', required(source.stream, 'Enter the stream key.'));
    put('group', required(source.group, 'Enter the consumer group.'));
  } else if (source.kind === 'sqs_compat') {
    put('queueUrl', required(source.queueUrl, 'Enter the queue URL.'));
    if (source.queueUrl.trim() && !/^https?:\/\/[^/\s]+/.test(source.queueUrl.trim())) {
      errors.queueUrl = 'Use an http:// or https:// URL with a host.';
    }
    if (
      source.longPollSecs.trim() &&
      (!Number.isInteger(Number(source.longPollSecs)) ||
        Number(source.longPollSecs) < 1 ||
        Number(source.longPollSecs) > 20)
    ) {
      errors.longPollSecs = 'Use a whole number from 1 to 20 seconds.';
    }
  } else if (source.kind === 'realtime') {
    if (!UUID.test(source.endpointId.trim())) {
      errors.endpointId = 'Enter the realtime endpoint ID (a UUID).';
    }
    if (!source.channel.trim() || source.channel.trim().length > 256) {
      errors.channel = 'Enter a channel of 1 to 256 characters.';
    }
    if (!source.group.trim() || source.group.trim().length > 128) {
      errors.group = 'Enter a consumer group of 1 to 128 characters.';
    }
    if (
      !Number.isInteger(source.maxConcurrency) ||
      source.maxConcurrency < 0 ||
      source.maxConcurrency > REALTIME_CONCURRENCY_MAX
    ) {
      errors.maxConcurrency = `Use a whole number from 0 to ${REALTIME_CONCURRENCY_MAX}.`;
    }
    // The bound consumer group owns ordering, filters, attempts and dead
    // letters; only messages per invocation is the trigger's, and only in batch.
    const size = draft.delivery.batchSizeMax;
    if (
      draft.delivery.mode === 'batch' &&
      (!Number.isInteger(size) || size < 1 || size > REALTIME_BATCH_MAX)
    ) {
      errors.batchSizeMax = `Messages per invocation must be a whole number from 1 to ${REALTIME_BATCH_MAX}.`;
    }
    return errors;
  }

  const numeric: Array<[keyof TriggerDeliveryDraft, number, number, string]> = [
    ['batchSizeMax', 1, draft.limits.trigger_batch_size_max, 'Batch size'],
    ['batchWindowMs', 10, draft.limits.trigger_batch_window_max_ms, 'Batch window'],
    ['maxAttempts', 1, draft.limits.trigger_max_attempts_max, 'Attempts'],
    ['payloadMaxBytes', 1024, draft.limits.trigger_payload_max_bytes, 'Payload cap'],
  ];
  for (const [key, min, max, label] of numeric) {
    const value = draft.delivery[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      errors[key] = `${label} must be a whole number from ${min} to ${max}.`;
    }
  }
  try {
    parseFilter(draft.filterCriteriaText);
  } catch {
    errors.filterCriteriaText = 'Enter a valid JSON object.';
  }
  return errors;
}

function buildSourceConfig(source: TriggerSourceDraft): Record<string, unknown> {
  switch (source.kind) {
    case 'kafka': {
      const config: Record<string, unknown> = {
        brokers: source.brokers
          .split(',')
          .map((broker) => broker.trim())
          .filter(Boolean),
        topic: source.topic.trim(),
        group: source.group.trim(),
      };
      if (source.tlsEnabled) {
        config.tls = {
          ...(source.caCert.trim() ? { ca_cert: source.caCert } : {}),
          ...(source.clientCert.trim() ? { client_cert: source.clientCert } : {}),
          ...(source.clientKey.trim() ? { client_key: source.clientKey } : {}),
          skip_verify: source.skipVerify,
        };
      }
      if (source.saslEnabled) {
        config.sasl = {
          mechanism: source.mechanism,
          username: source.username.trim(),
          ...(source.password ? { password: source.password } : {}),
        };
      }
      return config;
    }
    case 'nats':
      return {
        url: source.url.trim(),
        stream: source.stream.trim(),
        subject: source.subject.trim(),
        durable: source.durable.trim(),
      };
    case 'redis_streams':
      return {
        addr: source.addr.trim(),
        stream: source.stream.trim(),
        group: source.group.trim(),
      };
    case 'sqs_compat':
      return {
        queue_url: source.queueUrl.trim(),
        ...(source.longPollSecs.trim() ? { long_poll_secs: Number(source.longPollSecs) } : {}),
      };
    case 'queue':
      return { mode: source.mode };
    case 'realtime':
      return {
        endpoint_id: source.endpointId.trim(),
        channel: source.channel.trim(),
        group: source.group.trim(),
        ...(source.maxConcurrency > 0 ? { max_concurrency: source.maxConcurrency } : {}),
      };
  }
}

/**
 * A realtime trigger sends only what the trigger owns: apid rejects
 * batch_window_ms, max_attempts, retry_policy, broker_poison_strategy and
 * filter_criteria because the consumer group owns them, and allows a batch
 * size above 1 only with batch delivery (managedrealtime/triggers.go).
 */
function realtimeDelivery(delivery: TriggerDeliveryDraft) {
  return {
    delivery: delivery.mode,
    batch_size_max: delivery.mode === 'batch' ? delivery.batchSizeMax : 1,
    enabled: delivery.enabled,
  };
}

export function buildCreateTriggerRequest(draft: TriggerDraft): S['CreateTriggerRequest'] {
  if (draft.source.kind === 'realtime') {
    return {
      app_id: draft.appId,
      kind: 'realtime',
      slug: draft.slug.trim(),
      config: buildSourceConfig(draft.source),
      ...realtimeDelivery(draft.delivery),
    };
  }
  return {
    app_id: draft.appId,
    kind: draft.source.kind,
    slug: draft.slug.trim(),
    config: buildSourceConfig(draft.source),
    batch_size_max: draft.delivery.batchSizeMax,
    batch_window_ms: draft.delivery.batchWindowMs,
    max_attempts: draft.delivery.maxAttempts,
    payload_max_bytes: draft.delivery.payloadMaxBytes,
    broker_poison_strategy:
      draft.source.kind === 'kafka' ? draft.delivery.poisonStrategy : undefined,
    filter_criteria: parseFilter(draft.filterCriteriaText),
    ...(supportsBatchDelivery(draft.source.kind) ? { delivery: draft.delivery.mode } : {}),
    enabled: draft.delivery.enabled,
  };
}

export function buildUpdateTriggerRequest(
  draft: TriggerDraft,
  _original: S['Trigger']
): S['UpdateTriggerRequest'] {
  if (draft.source.kind === 'realtime') {
    return { config: buildSourceConfig(draft.source), ...realtimeDelivery(draft.delivery) };
  }
  return {
    config: buildSourceConfig(draft.source),
    batch_size_max: draft.delivery.batchSizeMax,
    batch_window_ms: draft.delivery.batchWindowMs,
    max_attempts: draft.delivery.maxAttempts,
    payload_max_bytes: draft.delivery.payloadMaxBytes,
    broker_poison_strategy:
      draft.source.kind === 'kafka' ? draft.delivery.poisonStrategy : undefined,
    filter_criteria: draft.filterCriteriaText.trim()
      ? parseFilter(draft.filterCriteriaText)
      : ({} as S['FilterCriteria']),
    ...(supportsBatchDelivery(draft.source.kind) ? { delivery: draft.delivery.mode } : {}),
    enabled: draft.delivery.enabled,
  };
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const truthy = (value: unknown) => value === true;

export function draftFromTrigger(trigger: S['Trigger'], limits: TriggerLimits): TriggerDraft {
  const config = record(trigger.config);
  let source: TriggerSourceDraft;
  switch (trigger.kind) {
    case 'kafka': {
      const tls = record(config.tls);
      const sasl = record(config.sasl);
      source = {
        kind: 'kafka',
        brokers: Array.isArray(config.brokers)
          ? config.brokers.filter((item): item is string => typeof item === 'string').join(', ')
          : text(config.brokers),
        topic: text(config.topic),
        group: text(config.group),
        tlsEnabled: Object.keys(tls).length > 0,
        caCert: text(tls.ca_cert),
        clientCert: text(tls.client_cert),
        clientKey: '',
        clientKeySet: truthy(tls.client_key_set),
        skipVerify: truthy(tls.skip_verify),
        saslEnabled: Object.keys(sasl).length > 0,
        mechanism: ['PLAIN', 'SCRAM-SHA-256', 'SCRAM-SHA-512'].includes(text(sasl.mechanism))
          ? (text(sasl.mechanism) as KafkaMechanism)
          : 'SCRAM-SHA-256',
        username: text(sasl.username),
        password: '',
        passwordSet: truthy(sasl.password_set),
      };
      break;
    }
    case 'nats':
      source = {
        kind: 'nats',
        url: text(config.url),
        stream: text(config.stream),
        subject: text(config.subject),
        durable: text(config.durable),
      };
      break;
    case 'redis_streams':
      source = {
        kind: 'redis_streams',
        addr: text(config.addr),
        stream: text(config.stream),
        group: text(config.group),
      };
      break;
    case 'sqs_compat':
      source = {
        kind: 'sqs_compat',
        queueUrl: text(config.queue_url),
        longPollSecs:
          typeof config.long_poll_secs === 'number' ? String(config.long_poll_secs) : '',
      };
      break;
    case 'queue':
      source = {
        kind: 'queue',
        mode: config.mode === 'delayed_task' ? 'delayed_task' : 'queue',
      };
      break;
    case 'realtime':
      source = {
        kind: 'realtime',
        endpointId: text(config.endpoint_id),
        channel: text(config.channel),
        group: text(config.group),
        maxConcurrency: typeof config.max_concurrency === 'number' ? config.max_concurrency : 0,
      };
      break;
    default:
      source = sourceDraft(allowedBrokerKinds(limits)[0] ?? 'queue');
  }

  return {
    appId: trigger.app_id,
    slug: trigger.slug ?? '',
    source,
    delivery: {
      mode: trigger.delivery === 'batch' ? 'batch' : 'record',
      batchSizeMax: trigger.batch_size_max,
      batchWindowMs: trigger.batch_window_ms,
      maxAttempts: trigger.max_attempts,
      payloadMaxBytes: trigger.payload_max_bytes,
      poisonStrategy: trigger.broker_poison_strategy,
      enabled: trigger.enabled,
    },
    filterCriteriaText: trigger.filter_criteria
      ? JSON.stringify(trigger.filter_criteria, null, 2)
      : '',
    limits,
  };
}

export function clearTriggerSecrets(draft: TriggerDraft): TriggerDraft {
  if (draft.source.kind !== 'kafka') return draft;
  return {
    ...draft,
    source: { ...draft.source, password: '', clientKey: '' },
  };
}
