import { expect, it } from 'vitest';
import { buildServicePolicyPatch, type ServicePolicyDraft } from './service-policy';

const base: ServicePolicyDraft = {
  callerMode: 'account',
  callers: '',
  scopeMode: 'clear',
  scopesJson: '',
  targets: '',
  policy: 'account',
  transport: 'http',
  allowForwardTargets: false,
};

it('preserves distinct inheritance, deny-all, scope and target wire semantics', () => {
  const choices = ['frontend', 'billing'];
  expect(buildServicePolicyPatch({ ...base, callerMode: 'account' }, choices).patch).toMatchObject({
    allowed_service_callers: null,
    allowed_service_call_scopes: null,
  });
  expect(
    buildServicePolicyPatch({ ...base, callerMode: 'deny', scopeMode: 'deny' }, choices).patch
  ).toMatchObject({ allowed_service_callers: [], allowed_service_call_scopes: {} });
  expect(
    buildServicePolicyPatch({ ...base, targets: '' }, choices).patch?.service_binding_targets
  ).toEqual([]);
});

it('requires known callers and explicit forward target review', () => {
  expect(
    buildServicePolicyPatch({ ...base, callerMode: 'allow', callers: 'unknown' }, ['billing']).error
  ).toMatch(/unknown caller/i);
  expect(buildServicePolicyPatch({ ...base, targets: 'future' }, ['billing']).error).toMatch(
    /future/i
  );
  expect(
    buildServicePolicyPatch({ ...base, targets: 'future', allowForwardTargets: true }, ['billing'])
      .forwardTargets
  ).toEqual(['future']);
});

it('accepts numeric-leading app slugs and ignores hidden caller text outside named-caller mode', () => {
  expect(
    buildServicePolicyPatch(
      { ...base, callerMode: 'allow', callers: '1frontend', targets: '2identity' },
      ['1frontend', '2identity']
    ).patch
  ).toMatchObject({
    allowed_service_callers: ['1frontend'],
    service_binding_targets: ['2identity'],
  });
  expect(
    buildServicePolicyPatch({ ...base, callerMode: 'deny', callers: 'invalid/hidden' }, []).patch
  ).toMatchObject({ allowed_service_callers: [] });
});

it('validates scoped method and path grants before review', () => {
  const draft: ServicePolicyDraft = {
    ...base,
    scopeMode: 'rules',
    scopesJson: '{"frontend":{"methods":["GET"],"path_prefixes":["/v1"]}}',
  };
  expect(buildServicePolicyPatch(draft, ['frontend']).patch?.allowed_service_call_scopes).toEqual({
    frontend: { methods: ['GET'], path_prefixes: ['/v1'] },
  });
  expect(
    buildServicePolicyPatch(
      { ...draft, scopesJson: '{"frontend":{"methods":["GET"],"path_prefixes":["x"]}}' },
      ['frontend']
    ).error
  ).toMatch(/path prefix/i);
});
