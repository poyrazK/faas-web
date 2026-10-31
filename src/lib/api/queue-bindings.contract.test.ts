import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const contract = readFileSync('api/openapi.yaml', 'utf8');

it('pins production queue consumers, worker profile and revision-fenced stage definitions', () => {
  expect(contract).toContain('/v1/apps/{slug}/queue-workload:');
  expect(contract).toContain('/v1/apps/{slug}/queue-bindings:');
  expect(contract).toContain('/v1/apps/{slug}/queue-bindings/{id}/status:');
  expect(contract).toContain(
    '/v1/projects/{slug}/environments/{environment}/workloads/{workload}/queue-bindings:'
  );
  expect(contract).toMatch(/QueueWorkloadProfileRequest:[\s\S]*?default push binding/);
  expect(contract).toMatch(
    /QueueBindingStatusResponse:[\s\S]*?consumer_state:[\s\S]*?consumer_liveness:[\s\S]*?last_poll_at:/
  );
  expect(contract).toMatch(
    /ReplaceProjectEnvironmentQueueBindingsRequest:[\s\S]*?expected_revision:[\s\S]*?bindings:/
  );
  expect(contract).toMatch(
    /ProjectEnvironmentQueueBindingsResponse:[\s\S]*?activation_state:[\s\S]*?unavailable/
  );
});
