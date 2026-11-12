import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePlanCatalog } from './plan-catalog-parser';

const source = readFileSync('content/docs/plans.md', 'utf8');

describe('generated API plan catalog', () => {
  it('reads every price and hard quota from the generated platform table', () => {
    expect(parsePlanCatalog(source)).toEqual({
      currency: 'USD',
      overagePerGbHour: 0.05,
      plans: [
        {
          name: 'Free',
          monthly: 0,
          deployedApps: 1,
          previewEnvironments: 1,
          developerApps: 1,
          concurrentInstances: 1,
          ramMb: 256,
          includedGbHours: 20,
          appEgressGib: 10,
          appLayerMb: 256,
          idleTimeout: '1m',
          maxRequestTimeout: '30s',
        },
        {
          name: 'Hobby',
          monthly: 10,
          deployedApps: 5,
          previewEnvironments: 2,
          developerApps: 2,
          concurrentInstances: 2,
          ramMb: 512,
          includedGbHours: 200,
          appEgressGib: 100,
          appLayerMb: 512,
          idleTimeout: '1m',
          maxRequestTimeout: '1m',
        },
        {
          name: 'Pro',
          monthly: 30,
          deployedApps: 25,
          previewEnvironments: 5,
          developerApps: 5,
          concurrentInstances: 5,
          ramMb: 1024,
          includedGbHours: 1000,
          appEgressGib: 500,
          appLayerMb: 1024,
          idleTimeout: '5m',
          maxRequestTimeout: '5m',
        },
        {
          name: 'Scale',
          monthly: 99,
          deployedApps: 100,
          previewEnvironments: 20,
          developerApps: 10,
          concurrentInstances: 20,
          ramMb: 2048,
          includedGbHours: 3000,
          appEgressGib: 2000,
          appLayerMb: 2048,
          idleTimeout: '10m',
          maxRequestTimeout: '15m',
        },
      ],
    });
  });
  it('ignores the developer-environment, realtime and object-storage tables that follow the plan table', () => {
    // Those tables also use bold plan-name rows; only the "At a glance" rows are quotas.
    expect(parsePlanCatalog(source).plans).toHaveLength(4);
    expect(source.match(/^\| \*\*/gm)?.length).toBeGreaterThan(4);
  });
  it.each([
    ['', 'empty source'],
    [source.replace('$30', '€30'), 'different currency'],
    [source.replace('billed at $0.05', 'billed at €0.05'), 'different overage currency'],
    [source.replace('1024 MB | 1000', 'unknown MB | 1000'), 'malformed quota'],
    [source.replace('Deployed apps', 'Unrecognised column'), 'changed schema'],
    [source.replace('| Max request timeout |', '|'), 'dropped column'],
    [source.replace('| **Pro** | $30', '| **Team** | $30'), 'unexpected plan set'],
    [source.replace(/\n\|---\|[^\n]*\n\| \*\*Free\*\*/, '\n\n| **Free**'), 'missing separator row'],
  ])('rejects an invalid catalog: %s (%s)', (input) => {
    expect(() => parsePlanCatalog(input)).toThrow();
  });
});
