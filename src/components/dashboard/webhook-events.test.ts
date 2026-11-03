import { expect, it } from 'vitest';
import { webhookEventLabel } from './webhook-events';

it('explains supported events without hiding historical or unknown event identifiers', () => {
  expect(webhookEventLabel('deployment.live')).toBe('A deployment goes live');
  expect(webhookEventLabel('error.new')).toBe('error.new');
  expect(webhookEventLabel('future.event')).toBe('future.event');
});
