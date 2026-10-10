import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const contract = readFileSync('api/openapi.yaml', 'utf8');

it('declares one-time Stripe ingress and versioned automation routing', () => {
  expect(contract).toContain('/v1/apps/{slug}/inbound-webhooks:');
  expect(contract).toContain('/v1/apps/{slug}/inbound-webhooks/{id}/automation-binding:');
  expect(contract).toContain('/v1/apps/{slug}/inbound-webhooks/{id}/automation-receipts/{event_id}:');
  expect(contract).toMatch(/endpoint_url:[\s\S]*?present only on create/);
  expect(contract).toMatch(/PutWebhookAutomationBindingRequest:[\s\S]*?expected_version[\s\S]*?take_over_delivery/);
});
