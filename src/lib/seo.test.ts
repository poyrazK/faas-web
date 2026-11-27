import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  consoleHead,
  fitMetaDescription,
  META_DESCRIPTION_MAX,
  pageHead,
  SITE_DESCRIPTION,
  SITE_NAME,
} from './seo';
import { NAV_ITEMS } from '@/components/dashboard/nav-config';

const titleOf = (head: ReturnType<typeof pageHead>) =>
  head.meta.find((m): m is { title: string } => 'title' in m)!.title;

const metaOf = (head: ReturnType<typeof pageHead>, key: string) =>
  head.meta.find((m) => 'name' in m && m.name === key) ??
  head.meta.find((m) => 'property' in m && m.property === key);

describe('fitMetaDescription', () => {
  it('leaves a description that already fits', () => {
    expect(fitMetaDescription('Structured logs.')).toBe('Structured logs.');
    expect(fitMetaDescription(SITE_DESCRIPTION)).toBe(SITE_DESCRIPTION);
  });

  it('keeps the leading whole sentences that fit', () => {
    const first =
      'Gregale runs every app instance in its own Firecracker microVM with its own kernel.';
    const second = 'Your existing Dockerfile works unchanged, with nothing to rewrite.';
    const third =
      'Snapshots park idle apps on disk and wake them with their process already running.';
    expect(fitMetaDescription(`${first} ${second} ${third}`)).toBe(`${first} ${second}`);
  });

  it('cuts one long sentence at a word boundary', () => {
    const long = `Compared on ${'idle billing, '.repeat(20)}and releases.`;
    const fitted = fitMetaDescription(long);
    expect(fitted.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
    expect(fitted.endsWith('…')).toBe(true);
    const kept = fitted.slice(0, -1);
    expect(long.startsWith(kept)).toBe(true);
    // The cut lands between words, not inside one.
    expect(long[kept.length]).toMatch(/[\s,]/);
  });

  it('caps the description pageHead writes', () => {
    const head = pageHead({ title: 'Long', description: 'word '.repeat(100) });
    expect(String(metaOf(head, 'description')?.content).length).toBeLessThanOrEqual(
      META_DESCRIPTION_MAX
    );
  });
});

describe('pageHead', () => {
  it('gives the untitled (landing) case the bare brand string', () => {
    expect(titleOf(pageHead())).toBe('Gregale — Backend cloud for APIs, Postgres & coding agents');
    // Search results and AI audits cut titles past 60 characters.
    expect(titleOf(pageHead()).length).toBeLessThanOrEqual(60);
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
    expect(titleOf(consoleHead('keys'))).toBe('API keys · Gregale');
    expect(titleOf(consoleHead('crons'))).toBe('Scheduled requests · Gregale');
    expect(titleOf(consoleHead('env'))).toBe('Env vars · Gregale');
    expect(titleOf(consoleHead('queues'))).toBe('Queues · Gregale');
  });

  it('titles the regrouped rail rows by their rail labels', () => {
    expect(titleOf(consoleHead('storage'))).toBe('Object storage · Gregale');
    expect(titleOf(consoleHead('edge-rules'))).toBe('Edge rules · Gregale');
    expect(titleOf(consoleHead('templates'))).toBe('Templates · Gregale');
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
      consoleHead('apps'),
    ].map(titleOf);

    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('SITE_DESCRIPTION', () => {
  it('leads with the product promise, not its maturity', () => {
    // The beta is stated once on the page, under the call to action. A search
    // snippet that opens with "in public beta" reads as a warning label.
    // Search and AI answers repeat this string, so it carries the positioning:
    // the whole backend, a VM per app, safe releases. Never price or idling.
    expect(SITE_DESCRIPTION).toMatch(/one command/i);
    expect(SITE_DESCRIPTION).toMatch(/Firecracker microVM/);
    expect(SITE_DESCRIPTION).toMatch(/roll back on errors/i);
    expect(SITE_DESCRIPTION).not.toMatch(/scales? (it )?to zero|cheap|\$/i);
    expect(SITE_DESCRIPTION).not.toMatch(/beta|preview/i);
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });

  it('is the same string index.html serves, in both meta tags', () => {
    // The description lives in three places (here, and twice in index.html
    // for description + og:description) because the shell has to carry it
    // before React boots. Nothing keeps them in sync but this test.
    const html = readFileSync('index.html', 'utf8');
    const contents = [...html.matchAll(/content="([^"]*)"/g)].map((m) => m[1]);
    expect(contents.filter((c) => c === SITE_DESCRIPTION)).toHaveLength(2);
  });
});
