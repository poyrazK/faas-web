import { expect, it } from 'vitest';
import * as db from './data';
import { slos } from './notification-channels';
import { createSLO, deleteSLO, getSLO, isProblem, sloStatus, type Answer } from './slos';

const app = db.apps[0];
const body = (answer: Answer) => {
  if (isProblem(answer)) throw new Error(`${answer.code}: ${answer.detail}`);
  return answer.body as Record<string, unknown> & { status?: Record<string, unknown> };
};

it('reads a seeded SLO with its budget over the window', () => {
  const seeded = slos.get(app.slug)!.find((s) => s.sli === 'availability')!;
  const out = body(getSLO(app.slug, seeded.id));
  expect(out.id).toBe(seeded.id);
  const st = out.status!;
  expect(st.source).toBe('prometheus');
  expect(st.hours_recorded).toBeGreaterThan(0);
  expect(st.hours_recorded).toBeLessThanOrEqual(st.hours_expected as number);
  expect(st.budget_remaining_pct).toBeCloseTo(50, 0);
});

it('has a seeded latency SLO burning faster than its budget', () => {
  const seeded = slos.get(app.slug)!.find((s) => s.sli === 'latency')!;
  const st = body(getSLO(app.slug, seeded.id)).status!;
  expect(st.burn_rate_1h).toBeGreaterThan(1);
  expect(st.budget_remaining_pct).toBeGreaterThan(0);
});

it('starts a new SLO’s window at its creation hour, so it reads pending', () => {
  const created = body(
    createSLO(app.slug, {
      name: 'mock-new',
      sli: 'availability',
      objective_pct: 99,
      window_days: 7,
    })
  );
  expect(created).toMatchObject({ name: 'mock-new', sli: 'availability', window_days: 7 });
  expect(created).not.toHaveProperty('latency_threshold_ms');
  const st = sloStatus(slos.get(app.slug)!.find((s) => s.id === created.id)!);
  expect(st.hours_recorded).toBe(0);
  expect(st.attainment_pct).toBeNull();
  expect(deleteSLO(app.slug, String(created.id))).toEqual({ status: 204 });
});

it('refuses what ValidateCreateSLO refuses, a taken name and an eleventh SLO', () => {
  const bad = (b: Record<string, unknown>) => createSLO(app.slug, b) as { code?: string };
  const base = { name: 'x', sli: 'availability', objective_pct: 99.9, window_days: 30 };
  expect(bad({ ...base, name: 'Upper' }).code).toBe('slo_invalid');
  expect(bad({ ...base, sli: 'latency' }).code).toBe('slo_invalid');
  expect(bad({ ...base, latency_threshold_ms: 250 }).code).toBe('slo_invalid');
  expect(bad({ ...base, objective_pct: 99.999 }).code).toBe('slo_invalid');
  expect(bad({ ...base, window_days: 14 }).code).toBe('slo_invalid');
  const taken = createSLO(app.slug, { ...base, name: 'availability' });
  expect(taken).toMatchObject({ status: 409, code: 'slo_invalid' });

  const other = db.apps[1];
  const made: string[] = [];
  while ((slos.get(other.slug) ?? []).length < 10)
    made.push(String(body(createSLO(other.slug, { ...base, name: `fill-${made.length}` })).id));
  expect(createSLO(other.slug, { ...base, name: 'eleventh' })).toMatchObject({
    status: 422,
    code: 'slo_limit_reached',
  });
  for (const id of made) deleteSLO(other.slug, id);
});

it('deletes the alert rules that name the SLO with it', () => {
  const seeded = slos.get(app.slug)!.find((s) => s.sli === 'availability')!;
  expect(db.alerts.get(app.slug)!.some((r) => r.slo_id === seeded.id)).toBe(true);
  expect(deleteSLO(app.slug, seeded.id)).toEqual({ status: 204 });
  expect(db.alerts.get(app.slug)!.some((r) => r.slo_id === seeded.id)).toBe(false);
  expect(getSLO(app.slug, seeded.id)).toMatchObject({ status: 404, code: 'not_found' });
});
