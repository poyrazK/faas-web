import { describe, expect, it } from 'vitest';
import {
  failureRulesDraftFrom,
  failureRulesErrors,
  failureRulesFrom,
  NO_FAILURE_RULES,
  parseEnvLines,
  parseRunInputs,
  isManifestDigest,
  isManifestUri,
} from './job-drafts';

describe('parseRunInputs', () => {
  it('reads one ID=REF per line in order, splitting on the first =', () => {
    expect(parseRunInputs('shard-a=s3://b/a\n\n  shard-b=s3://b/b?x=1  \n')).toEqual({
      inputs: [
        { input_id: 'shard-a', input_ref: 's3://b/a' },
        { input_id: 'shard-b', input_ref: 's3://b/b?x=1' },
      ],
    });
  });

  it.each([
    ['', 'Add at least one input'],
    ['no-equals', 'Line 1'],
    ['=ref', 'Line 1'],
    ['a=', 'Line 1'],
    ['a=1\na=2', 'appears twice'],
    [`${'x'.repeat(129)}=r`, '128'],
    [`a=${'r'.repeat(2049)}`, '2048'],
  ])('refuses %j', (text, message) => {
    expect(parseRunInputs(text).error).toContain(message);
  });

  it('refuses more inputs than a run can hold', () => {
    const text = Array.from({ length: 5001 }, (_, i) => `i${i}=r`).join('\n');
    expect(parseRunInputs(text).error).toMatch(/5,000/);
  });
});

describe('parseEnvLines', () => {
  it('reads KEY=VALUE lines, keeping = inside the value', () => {
    expect(parseEnvLines('LOG_LEVEL=debug\nQUERY=a=b\n')).toEqual({
      env: { LOG_LEVEL: 'debug', QUERY: 'a=b' },
    });
  });

  it('allows an empty value', () => {
    expect(parseEnvLines('EMPTY=')).toEqual({ env: { EMPTY: '' } });
  });

  it.each([
    ['lower=1', 'Line 1'],
    ['1KEY=1', 'Line 1'],
    ['NOEQUALS', 'Line 1'],
    ['A=1\nA=2', 'appears twice'],
  ])('refuses %j', (text, message) => {
    expect(parseEnvLines(text).error).toContain(message);
  });

  it('refuses the platform prefix only when asked to', () => {
    expect(parseEnvLines('GREGALE_X=1', { reservePlatform: true }).error).toMatch(/GREGALE_/);
    expect(parseEnvLines('GREGALE_X=1').env).toEqual({ GREGALE_X: '1' });
  });
});

describe('manifest fields', () => {
  it('accepts an obj:// object and a sha256 digest', () => {
    expect(isManifestUri('obj://app/bucket/inputs.json')).toBe(true);
    expect(isManifestUri('s3://bucket/inputs.json')).toBe(false);
    expect(isManifestUri('obj://app/bucket')).toBe(false);
    expect(isManifestDigest(`sha256:${'a'.repeat(64)}`)).toBe(true);
    expect(isManifestDigest(`sha256:${'A'.repeat(64)}`)).toBe(false);
    expect(isManifestDigest('a'.repeat(64))).toBe(false);
  });
});

describe('failure rules draft', () => {
  it('round-trips the API shape', () => {
    const rules = {
      version: 1 as const,
      rules: [
        { exit_codes: [65, 66], action: 'fail_partition' as const },
        { outcome_codes: ['upstream_unavailable'], action: 'retry' as const },
      ],
      unmatched_failure: 'retry' as const,
      uncertain_outcome: 'hold' as const,
    };
    const draft = failureRulesDraftFrom(rules);
    expect(draft.enabled).toBe(true);
    expect(failureRulesErrors(draft)).toEqual({});
    expect(failureRulesFrom(draft)).toEqual(rules);
  });

  it('starts off, with the safe defaults', () => {
    expect(failureRulesDraftFrom(undefined)).toEqual(NO_FAILURE_RULES);
    expect(failureRulesFrom(NO_FAILURE_RULES)).toBeUndefined();
  });

  it.each([
    [{ kind: 'exit' as const, codes: '0' }, 'between 1 and 255'],
    [{ kind: 'exit' as const, codes: '256' }, 'between 1 and 255'],
    [{ kind: 'exit' as const, codes: 'x' }, 'between 1 and 255'],
    [{ kind: 'exit' as const, codes: '' }, 'at least one'],
    [{ kind: 'outcome' as const, codes: 'Not-Valid' }, 'lowercase'],
    [{ kind: 'outcome' as const, codes: `${'a'.repeat(65)}` }, 'lowercase'],
  ])('refuses the matcher %j', (rule, message) => {
    const draft = {
      ...NO_FAILURE_RULES,
      enabled: true,
      rules: [{ ...rule, action: 'retry' as const }],
    };
    expect(failureRulesErrors(draft).rules?.[0]).toContain(message);
  });

  it('refuses a code matched by two rules, as apid does', () => {
    const draft = {
      ...NO_FAILURE_RULES,
      enabled: true,
      rules: [
        { kind: 'exit' as const, codes: '65', action: 'retry' as const },
        { kind: 'exit' as const, codes: '65, 66', action: 'fail_partition' as const },
      ],
    };
    expect(failureRulesErrors(draft).rules?.[1]).toMatch(/65.*another rule/);
  });

  it('allows no rules at all, leaving only the unmatched and uncertain choices', () => {
    const draft = { ...NO_FAILURE_RULES, enabled: true, unmatched: 'fail_partition' as const };
    expect(failureRulesErrors(draft)).toEqual({});
    expect(failureRulesFrom(draft)).toEqual({
      version: 1,
      rules: [],
      unmatched_failure: 'fail_partition',
      uncertain_outcome: 'hold',
    });
  });
});
