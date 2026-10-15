import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const contract = readFileSync('api/openapi.yaml', 'utf8');

it('pins internal visibility, service policy null semantics and read-only binding evidence', () => {
  expect(contract).toContain('/v1/apps/{slug}/bindings:');
  expect(contract).toMatch(/AppResponse:[\s\S]*?visibility:[\s\S]*?allowed_service_callers:/);
  expect(contract).toMatch(/CreateAppRequest:[\s\S]*?visibility:[\s\S]*?service_binding_targets:/);
  expect(contract).toMatch(
    /UpdateAppRequest:[\s\S]*?allowed_service_callers:[\s\S]*?\[\] to deny all[\s\S]*?null to restore same-account access/
  );
  expect(contract).toMatch(
    /UpdateAppRequest:[\s\S]*?service_binding_targets:[\s\S]*?null to keep unchanged; \[\] clears/
  );
  expect(contract).toMatch(/AppBindingInventory:[\s\S]*?complete:[\s\S]*?AppBindingInventoryItem/);
  expect(contract).toMatch(
    /AppBindingInventoryItem:[\s\S]*?runtime_status:[\s\S]*?verification_status:/
  );
});
