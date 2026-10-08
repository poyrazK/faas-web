import { describe, expect, it } from 'vitest';
import {
  availabilityMessage,
  candidateDefinition,
  definitionDraft,
  newDefinition,
  parseDefinition,
} from './automation-definition';

describe('automation authoring', () => {
  it('preserves advanced definition fields while editing ordinary step input', () => {
    const spec = {
      ...newDefinition(),
      name: 'orders',
      max_concurrent_runs: 7,
      steps: [
        {
          name: 'lookup',
          path: '/lookup',
          on_failure: 'recover',
          when: { ref: 'input.ready', op: 'eq' as const, value: true },
          input: { old: true },
        },
      ],
    };
    const draft = definitionDraft(spec);
    draft.steps[0].input = '{"order":"{{input.order_id}}"}';
    draft.steps[0].dependencies = 'first, second';
    const candidate = candidateDefinition(draft);
    expect(candidate.max_concurrent_runs).toBe(7);
    expect(candidate.steps[0]).toMatchObject({
      on_failure: 'recover',
      when: spec.steps[0].when,
      depends_on: ['first', 'second'],
      input: { order: '{{input.order_id}}' },
    });
  });
  it('rejects malformed inputs and non-object event filters before any request', () => {
    const draft = definitionDraft(newDefinition());
    draft.steps[0].input = '{';
    expect(() => candidateDefinition(draft)).toThrow('Step 1 input must be valid JSON');
    draft.steps[0].input = 'null';
    draft.spec.trigger = { type: 'event', source: 'orders', event_type: '*' };
    draft.eventFilter = '[]';
    expect(() => candidateDefinition(draft)).toThrow('Event filter must be a JSON object');
  });
  it('omits input from durable callback waits', () => {
    const spec = {
      ...newDefinition(),
      steps: [{ name: 'wait', wait_for_callback: true, timeout: '1h' }],
    };
    expect(candidateDefinition(definitionDraft(spec)).steps[0]).not.toHaveProperty('input');
  });
  it('does not accept incomplete advanced definitions', () => {
    expect(() => parseDefinition('{"name":"orders","steps":[null]}')).toThrow();
    expect(() => parseDefinition('{"name":"orders"}')).toThrow();
  });
  it('uses API availability rather than a hardcoded plan entitlement', () => {
    expect(availabilityMessage(true)).toBeUndefined();
    expect(availabilityMessage(false)).toMatch(/not enabled/);
    expect(availabilityMessage(true, 'plan_not_allowed')).toMatch(/plan/);
    expect(availabilityMessage(true, 'deployment_unavailable')).toMatch(/Deploy/);
    expect(availabilityMessage(true, 'new_reason')).toContain('new_reason');
  });
});
