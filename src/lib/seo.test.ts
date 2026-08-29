import { describe, expect, it } from 'vitest';
import { consoleHead, pageHead, SITE_NAME } from './seo';
import { NAV_ITEMS } from '@/components/dashboard/nav-config';

const titleOf = (head: ReturnType<typeof pageHead>) =>
  head.meta.find((m): m is { title: string } => 'title' in m)!.title;

const metaOf = (head: ReturnType<typeof pageHead>, key: string) =>
  head.meta.find((m) => 'name' in m && m.name === key) ??
  head.meta.find((m) => 'property' in m && m.property === key);

describe('pageHead', () => {
  it('gives the untitled (landing) case the bare brand string', () => {
    expect(titleOf(pageHead())).toBe('Gregale — Serverless on real microVMs');
  });

  it('suffixes the brand so the distinguishing half survives a narrow tab', () => {
    expect(titleOf(pageHead({ title: 'Sign in' }))).toBe('Sign in · Gregale');
    expect(titleOf(pageHead({ title: 'Sign in' })).startsWith('Sign in')).toBe(true);
  });

  it('always carries a description', () => {
    expect(metaOf(pageHead(), 'description')).toBeDefined();
    expect(metaOf(pageHead({ title: 'Overview' }), 'description')).toBeDefined();
  });

  it('accepts a per-route description', () => {
    const head = pageHead({ title: 'Logs', description: 'Structured logs.' });
    expect(metaOf(head, 'description')).toMatchObject({ content: 'Structured logs.' });
  });

  it('restates og:title and og:description to match the page', () => {
    const head = pageHead({ title: 'Plans', description: 'Pick a plan.' });
    expect(metaOf(head, 'og:title')).toMatchObject({ content: 'Plans · Gregale' });
    expect(metaOf(head, 'og:description')).toMatchObject({ content: 'Pick a plan.' });
  });
});

describe('consoleHead', () => {
  it('reads the label from the nav config rather than restating it', () => {
    // These differ from their URL segment, so a passing assertion proves the
    // lookup happened instead of the segment being title-cased.
    expect(titleOf(consoleHead('keys'))).toBe('API Keys · Gregale');
    expect(titleOf(consoleHead('crons'))).toBe('Cron Jobs · Gregale');
    expect(titleOf(consoleHead('env'))).toBe('Env vars · Gregale');
    expect(titleOf(consoleHead('queues'))).toBe('Queues · Gregale');
  });

  it('falls back to the raw segment for an unknown one', () => {
    expect(titleOf(consoleHead('nonexistent'))).toBe('nonexistent · Gregale');
  });

  it('resolves a real label for every console route in the nav', () => {
    const segments = NAV_ITEMS.filter((i) => i.to !== '/dashboard').map((i) =>
      i.to.split('/').pop()!
    );
    expect(segments.length).toBeGreaterThan(0);

    for (const segment of segments) {
      // A title equal to the bare segment means SECTION_LABELS missed it and
      // the page would show a lowercase slug.
      expect(titleOf(consoleHead(segment))).not.toBe(`${segment} · ${SITE_NAME}`);
    }
  });
});

describe('titles across the app', () => {
  it('are distinct, so tabs and history entries can be told apart', () => {
    const titles = [
      pageHead(),
      pageHead({ title: 'Sign in' }),
      pageHead({ title: 'Create account' }),
      pageHead({ title: 'Get started' }),
      pageHead({ title: 'Overview' }),
      pageHead({ title: 'New workflow' }),
      consoleHead('logs'),
      consoleHead('metrics'),
      consoleHead('workflows'),
    ].map(titleOf);

    expect(new Set(titles).size).toBe(titles.length);
  });
});
