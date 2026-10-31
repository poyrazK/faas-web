import { expect, it } from 'vitest';
import * as db from './data';
import { readWakeAhead, writeWakeAhead } from './wake-ahead';

const app = (slug: string) => db.apps.find((a) => a.slug === slug)!;

it('reports a project service on its default as on, with no updated_at', () => {
  const out = readWakeAhead(app('api-gateway'));
  expect(out).toMatchObject({ slug: 'api-gateway', enabled: true });
  expect(out.updated_at).toBeUndefined();
});

it('reports measured edges only to other apps of the account', () => {
  const learned = readWakeAhead(app('api-gateway')).learned!;
  expect(learned.source).toBe('live');
  expect(learned.caller_wakes).toBeGreaterThanOrEqual(20);
  expect(learned.targets.map((t) => t.slug)).toEqual(['image-resize', 'webhook-router']);
  for (const target of learned.targets) expect(target.app_id).toBe(app(target.slug).id);
});

it('keeps an explicit choice, stamps it, and answers without a learned block', () => {
  const out = writeWakeAhead(app('nightly-etl'), true);
  expect(out).toMatchObject({ slug: 'nightly-etl', enabled: true });
  expect(Date.parse(out!.updated_at!)).not.toBeNaN();
  expect(out!.learned).toBeUndefined();
  expect(readWakeAhead(app('nightly-etl')).enabled).toBe(true);
});

it('rejects anything but a boolean, like the handler', () => {
  expect(writeWakeAhead(app('nightly-etl'), 'on')).toBeUndefined();
  expect(writeWakeAhead(app('nightly-etl'), undefined)).toBeUndefined();
});

it('never learns for a PR preview, and says when gateway metrics cannot be read', () => {
  const preview = db.apps.find((a) => a.preview_of_slug)!;
  expect(readWakeAhead(preview)).toMatchObject({ enabled: false });
  expect(readWakeAhead(preview).learned!.targets).toEqual([]);
  expect(readWakeAhead(app('billing-recon')).learned!.source).toBe('unavailable');
});
