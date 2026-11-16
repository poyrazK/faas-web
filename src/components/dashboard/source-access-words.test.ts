import { describe, expect, it } from 'vitest';
import type { DeployToken } from '@/lib/api/deploy-tokens';
import {
  dayWords,
  registryLine,
  registryQuotaWords,
  requireSignedNote,
  supplyChainLine,
  timeLeftWords,
  tokenDetail,
  tokenLine,
  tokensLine,
  tokenState,
} from './source-access-words';

const NOW = new Date(2026, 10, 11, 15, 0).getTime();
const DAY = 86_400_000;
const at = (ms: number) => new Date(ms).toISOString();

const token = (over: Partial<DeployToken> = {}): DeployToken =>
  ({
    id: '6f1c2b1e-0000-4000-8000-000000000001',
    app_id: 'app-1',
    prefix: 'fp_deploy_',
    label: 'github-actions',
    scopes: ['deploy:write'],
    status: 'active',
    created_at: at(NOW - 40 * DAY),
    expires_at: at(NOW + 50 * DAY),
    ...over,
  }) as DeployToken;

describe('dayWords and timeLeftWords', () => {
  it('names past days by the calendar', () => {
    expect(dayWords(at(NOW - 60_000), NOW)).toBe('today');
    expect(dayWords(at(NOW - DAY), NOW)).toBe('yesterday');
    expect(dayWords(at(NOW - 3 * DAY), NOW)).toBe('3 days ago');
    expect(dayWords(at(NOW - 20 * DAY), NOW)).toMatch(/^on /);
    expect(dayWords(undefined, NOW)).toBeNull();
    expect(dayWords('not a date', NOW)).toBeNull();
  });

  it('rounds time left down, and has nothing to say about the past', () => {
    expect(timeLeftWords(at(NOW + 6.9 * DAY), NOW)).toBe('in 6 days');
    expect(timeLeftWords(at(NOW + 1.5 * DAY), NOW)).toBe('in 1 day');
    expect(timeLeftWords(at(NOW + 3_600_000), NOW)).toBe('within a day');
    expect(timeLeftWords(at(NOW - DAY), NOW)).toBeNull();
  });
});

describe('supplyChainLine', () => {
  it('says nothing until the app read answers', () => {
    expect(supplyChainLine(undefined, 1)).toBeNull();
  });
  it('counts publishers when any image may deploy', () => {
    expect(supplyChainLine(false, 1)?.sentence).toBe(
      'Any image can be deployed. 1 trusted publisher is set up.'
    );
    expect(supplyChainLine(false, 2)?.sentence).toBe(
      'Any image can be deployed. 2 trusted publishers are set up.'
    );
    expect(supplyChainLine(false, 0)?.sentence).toBe(
      'Any image can be deployed. No trusted publisher is set up yet.'
    );
    expect(supplyChainLine(false, undefined)?.sentence).toBe('Any image can be deployed.');
  });
  it('flags a requirement no publisher can meet', () => {
    expect(supplyChainLine(true, 1)).toEqual({
      sentence: 'Only images signed by a trusted publisher can be deployed.',
      tone: 'good',
    });
    expect(supplyChainLine(true, 0)?.tone).toBe('critical');
    // Publishers still loading: no claim that deploys are refused.
    expect(supplyChainLine(true, undefined)?.tone).toBe('good');
  });
  it('warns before turning the toggle on with no publisher', () => {
    expect(requireSignedNote(0, false).tone).toBe('warning');
    expect(requireSignedNote(1, false).sentence).toMatch(/Unsigned images are refused/);
    expect(requireSignedNote(undefined, false).tone).toBe('neutral');
    expect(requireSignedNote(1, true).sentence).not.toMatch(/Turn it on/);
  });
});

describe('registry words', () => {
  it('says what a login is for when there is none, and names one host', () => {
    expect(registryLine([])).toBe(
      'Add a login so Gregale can pull images from a private registry.'
    );
    expect(registryLine(['ghcr.io'])).toBe(
      'Gregale signs in to ghcr.io when it pulls private images.'
    );
    expect(registryLine(['a.io', 'b.io'])).toBe(
      'Gregale signs in to 2 private registries when it pulls images.'
    );
  });
  it('keeps the cap for a tip, and only when the API states one', () => {
    expect(registryQuotaWords(20)).toBe('Up to 20 registries; replacing one does not use another.');
    expect(registryQuotaWords(undefined)).toBeNull();
  });
});

describe('deploy token words', () => {
  it('lets the clock decide expiry, and keeps grace distinct', () => {
    expect(tokenState(token({ expires_at: at(NOW - 1) }), NOW)).toBe('expired');
    expect(tokenState(token({ status: 'revoked' }), NOW)).toBe('revoked');
    expect(tokenState(token({ status: 'grace' }), NOW)).toBe('grace');
  });

  it('gives each row one quiet line, calling out an expiry inside two weeks', () => {
    expect(tokenLine(token({ last_used_at: at(NOW - 60_000) }), NOW)).toEqual({
      text: 'Last used today',
      soon: false,
    });
    expect(tokenLine(token({ expires_at: at(NOW + 6.5 * DAY) }), NOW)).toEqual({
      text: 'Never used · expires in 6 days',
      soon: true,
    });
    expect(tokenLine(token({ status: 'revoked', revoked_at: at(NOW - DAY) }), NOW).text).toBe(
      'Revoked yesterday'
    );
    expect(tokenLine(token({ expires_at: at(NOW - 2 * DAY) }), NOW).text).toBe(
      'Expired 2 days ago'
    );
  });

  it('keeps exact dates and the prefix for the title', () => {
    const detail = tokenDetail(token());
    expect(detail).toMatch(/^Created /);
    expect(detail).toMatch(/Starts fp_deploy_…/);
    expect(detail).toMatch(/Status: active$/);
  });

  it('sums the tokens up in one sentence', () => {
    expect(tokensLine([], 'alpha', NOW).sentence).toBe(
      'No deploy tokens yet. Create one so CI can deploy alpha.'
    );
    expect(
      tokensLine(
        [
          token({ last_used_at: at(NOW - 60_000) }),
          token({ id: 'b', label: 'buildkite', last_used_at: at(NOW - 5 * DAY) }),
          token({ id: 'c', label: 'old', status: 'revoked', last_used_at: at(NOW) }),
        ],
        'alpha',
        NOW
      ).sentence
    ).toBe('2 active tokens. github-actions was last used today.');
    expect(tokensLine([token()], 'alpha', NOW).sentence).toBe(
      '1 active token. It hasn’t been used yet.'
    );
  });

  it('adds the soonest expiry, and says when no token can deploy', () => {
    const soon = tokensLine(
      [token({ label: 'nightly', expires_at: at(NOW + 3.2 * DAY) })],
      'alpha',
      NOW
    );
    expect(soon).toEqual({
      sentence: '1 active token. It hasn’t been used yet. nightly expires in 3 days.',
      tone: 'warning',
    });
    expect(tokensLine([token({ expires_at: at(NOW - DAY) })], 'alpha', NOW)).toEqual({
      sentence: 'No token can deploy alpha right now. 1 token has expired.',
      tone: 'warning',
    });
    expect(tokensLine([token({ status: 'revoked' })], 'alpha', NOW)).toEqual({
      sentence: 'No token can deploy alpha right now.',
      tone: 'neutral',
    });
  });
});
