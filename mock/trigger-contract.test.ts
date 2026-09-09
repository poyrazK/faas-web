import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FREE_TRIGGER_ERROR_CODE,
  KAFKA_SASL_MECHANISMS,
  TRIGGER_CAPABILITIES_BY_PLAN,
  triggerDefaultsFor,
} from './trigger-contract';

const spec = readFileSync('api/openapi.yaml', 'utf8');

describe('mock trigger contract', () => {
  it('uses only OpenAPI kinds and Kafka SASL mechanisms', () => {
    for (const mechanism of KAFKA_SASL_MECHANISMS) expect(spec).toContain(mechanism);
    for (const capability of Object.values(TRIGGER_CAPABILITIES_BY_PLAN)) {
      for (const kind of capability.trigger_kinds) expect(spec).toContain(kind);
    }
  });

  it('matches the production Hobby defaults and Free error code', () => {
    expect(triggerDefaultsFor('hobby')).toEqual({
      batch_size_max: 50,
      batch_window_ms: 1000,
      max_attempts: 3,
      payload_max_bytes: 1_048_576,
    });
    expect(FREE_TRIGGER_ERROR_CODE).toBe('plan_triggers_not_allowed');
  });
});
