import { describe, expect, it } from 'vitest';
import { advanceDeployment } from './plugin';

const dep = (repo: string) =>
  ({ status: 'queued', created_at: new Date(0).toISOString(), repo }) as {
    status: string;
    created_at: string;
    repo: string;
    error_why?: string;
    error_code?: string;
  };

describe('advanceDeployment', () => {
  it.each([
    [1_000, 'queued'],
    [3_000, 'building'],
    [8_000, 'deploying'],
    [11_000, 'active'],
  ])('a healthy repo at %ims is %s', (ms, status) => {
    expect(advanceDeployment(dep('acme/api'), ms).status).toBe(status);
  });

  it('fails a broken repo at the build step with a real cause', () => {
    const d = advanceDeployment(dep('acme/broken-api'), 8_000);
    expect(d.status).toBe('failed');
    expect(d.error_why).toBe("Cannot find module './db'");
    expect(d.error_code).toBe('build_failed');
  });
});
