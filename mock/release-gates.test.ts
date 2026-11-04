import { expect, it } from 'vitest';
import { mockCapabilities } from './capabilities';
import * as db from './data';
import { create, list, remove } from './release-gates';
import { GuardProblem } from './release-freezes';

const refused = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof GuardProblem ? { status: err.status, code: err.code } : err;
  }
  return null;
};
const slug = db.apps[3].slug;

it('lists release gates as a preview on every plan', () => {
  const free = mockCapabilities('free', []).capabilities.find((c) => c.key === 'release-gates');
  expect(free).toMatchObject({ maturity: 'preview', enabled: true });
});

it('creates each kind with its defaults and its own target', () => {
  expect(create(slug, { name: 'avail', kind: 'slo', slo: 'availability' }, 'me')).toMatchObject({
    max_burn_rate: 10,
    min_samples: 20,
  });
  expect(create(slug, { name: 'probe', kind: 'synthetic', check: 'health' }, 'me')).toMatchObject({
    max_failure_percent: 10,
    min_samples: 6,
  });
  expect(
    refused(() => create(slug, { name: 'missing', kind: 'slo', slo: 'nope' }, 'me'))
  ).toMatchObject({
    code: 'validation_failed',
  });
  expect(refused(() => create(slug, { name: 'avail', kind: 'new_errors' }, 'me'))).toMatchObject({
    status: 409,
  });
  expect(list(slug).map((g) => g.name)).toEqual(['avail', 'probe']);
});

it('removes a gate by name and says when there is none', () => {
  expect(remove(slug, 'probe').name).toBe('probe');
  expect(refused(() => remove(slug, 'probe'))).toMatchObject({
    status: 404,
    code: 'release_gate_not_found',
  });
});

it('holds at most ten gates per app', () => {
  const app = db.apps[4].slug;
  for (let i = 0; i < 10; i++) create(app, { name: `g${i}`, kind: 'new_errors' }, 'me');
  expect(refused(() => create(app, { name: 'g10', kind: 'new_errors' }, 'me'))).toMatchObject({
    code: 'release_gate_limit',
  });
});
