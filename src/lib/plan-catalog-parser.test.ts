import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePlanCatalog } from './plan-catalog-parser';

const source = readFileSync('content/docs/plans.md', 'utf8');

describe('generated API plan catalog', () => {
  it('reads every price and hard quota from the generated platform table', () => {
    expect(parsePlanCatalog(source)).toEqual({
      currency: 'EUR',
      overagePerGbHour: 0.01,
      plans: [
        {
          name: 'Free',
          monthly: 0,
          deployedApps: 1,
          developerApps: 1,
          concurrentInstances: 1,
          ramMb: 128,
          includedGbHours: 5,
          appLayerMb: 256,
          idleTimeout: '1m',
        },
        {
          name: 'Hobby',
          monthly: 9,
          deployedApps: 5,
          developerApps: 2,
          concurrentInstances: 2,
          ramMb: 256,
          includedGbHours: 50,
          appLayerMb: 512,
          idleTimeout: '1m',
        },
        {
          name: 'Pro',
          monthly: 29,
          deployedApps: 25,
          developerApps: 5,
          concurrentInstances: 5,
          ramMb: 512,
          includedGbHours: 250,
          appLayerMb: 1024,
          idleTimeout: '5m',
        },
        {
          name: 'Scale',
          monthly: 99,
          deployedApps: 100,
          developerApps: 10,
          concurrentInstances: 20,
          ramMb: 1024,
          includedGbHours: 1500,
          appLayerMb: 2048,
          idleTimeout: '10m',
        },
      ],
    });
  });
  it.each([
    ['', 'empty source'],
    [source.replace('€29', '$29'), 'different currency'],
    [source.replace('512 MB | 250', 'unknown MB | 250'), 'malformed quota'],
    [source.replace('Deployed apps', 'Unrecognised column'), 'changed schema'],
  ])('rejects an invalid catalog: %s (%s)', (input) => {
    expect(() => parsePlanCatalog(input)).toThrow();
  });
});
