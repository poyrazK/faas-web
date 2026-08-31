import { describe, expect, it } from 'vitest';
import { certTone, hostnameState } from './tenant-surfaces';

describe('hostnameState', () => {
  it('is failed when there is a last_error and not verified', () => {
    expect(
      hostnameState({
        hostname: 'a.example',
        verified: false,
        txt_record: 'x',
        last_error: 'NXDOMAIN',
      })
    ).toBe('failed');
    expect(hostnameState({ hostname: 'a.example', verified: false, txt_record: 'x' })).toBe(
      'pending'
    );
    expect(
      hostnameState({ hostname: 'a.example', verified: true, txt_record: 'x', last_error: 'old' })
    ).toBe('verified');
  });
});

describe('certTone', () => {
  it('maps the five states', () => {
    expect(['none', 'pending', 'issued', 'renewing', 'failed'].map(certTone)).toEqual([
      'neutral',
      'warning',
      'good',
      'warning',
      'bad',
    ]);
  });
});
