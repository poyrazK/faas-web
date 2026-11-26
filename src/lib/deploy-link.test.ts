import { describe, expect, it } from 'vitest';
import {
  deployBadgeMarkdown,
  deployButtonSearch,
  deployDestinationPath,
  findPublicTemplateByRepo,
  isDeployablePublicTemplate,
  parseDeployRepo,
} from './deploy-link';
import { PUBLIC_TEMPLATES } from './public-templates';

describe('deploy-link helpers', () => {
  it('normalizes valid GitHub URLs and owner/repo slugs', () => {
    expect(parseDeployRepo('https://github.com/gregale-dev/nextjs-postgres-starter')).toBe(
      'gregale-dev/nextjs-postgres-starter'
    );
    expect(parseDeployRepo('https://github.com/gregale-dev/nextjs-postgres-starter.git/')).toBe(
      'gregale-dev/nextjs-postgres-starter'
    );
    expect(parseDeployRepo('https://github.com/gregale-dev/nextjs-postgres-starter.git')).toBe(
      'gregale-dev/nextjs-postgres-starter'
    );
    expect(parseDeployRepo('https://www.github.com/gregale-dev/mcp-server-python/')).toBe(
      'gregale-dev/mcp-server-python'
    );
    expect(parseDeployRepo('github.com/gregale-dev/bun-hono-postgres-starter')).toBe(
      'gregale-dev/bun-hono-postgres-starter'
    );
    expect(parseDeployRepo('gregale-dev/fastapi-postgres-jobs')).toBe(
      'gregale-dev/fastapi-postgres-jobs'
    );
  });

  it('rejects non-GitHub hosts, nested paths, and unsafe inputs', () => {
    for (const invalid of [
      '',
      null,
      undefined,
      'https://gitlab.com/org/repo',
      'https://evil.com/github.com/org/repo',
      'https://github.com/org/repo/tree/main',
      'https://github.com/only-owner',
      '//github.com/org/repo',
      'javascript:alert(1)',
      'owner/repo with space',
    ]) {
      expect(parseDeployRepo(invalid), String(invalid)).toBeUndefined();
    }
  });

  it('builds validated dashboard destination paths and button search params', () => {
    expect(deployDestinationPath('gregale-dev/nextjs-postgres-starter')).toBe(
      '/dashboard/apps/new?source=git&repo=gregale-dev%2Fnextjs-postgres-starter'
    );
    expect(deployDestinationPath('gregale-dev/nextjs-postgres-starter', 'release/v2')).toBe(
      '/dashboard/apps/new?source=git&repo=gregale-dev%2Fnextjs-postgres-starter&ref=release%2Fv2'
    );
    expect(deployDestinationPath('gregale-dev/nextjs-postgres-starter', 'bad ref with space')).toBe(
      '/dashboard/apps/new?source=git&repo=gregale-dev%2Fnextjs-postgres-starter'
    );
    expect(deployButtonSearch('gregale-dev/mcp-server-go', 'main')).toEqual({
      repo: 'https://github.com/gregale-dev/mcp-server-go',
      ref: 'main',
    });
  });

  it('matches official public starters and identifies the 11 deployable repos', () => {
    const deployables = PUBLIC_TEMPLATES.filter(isDeployablePublicTemplate);
    expect(deployables).toHaveLength(11);
    expect(findPublicTemplateByRepo('gregale-dev/postgres-migration-rollback-demo')?.slug).toBe(
      'postgres-migration-rollback-demo'
    );
    expect(findPublicTemplateByRepo('acme/unrelated-repo')).toBeUndefined();
    expect(deployBadgeMarkdown('gregale-dev/node-api-worker')).toBe(
      '[![Deploy on Gregale](https://gregale.dev/deploy-badge.svg)](https://gregale.dev/deploy?repo=https://github.com/gregale-dev/node-api-worker)'
    );
  });
});
