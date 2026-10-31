import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const contract = readFileSync('api/openapi.yaml', 'utf8');

it('pins scoped Issues reads, actions and one-time deployment token metadata', () => {
  expect(contract).toContain('/v1/apps/{slug}/issues:');
  expect(contract).toContain('/v1/apps/{slug}/issues/{issue_id}:');
  expect(contract).toContain('/v1/apps/{slug}/issues/{issue_id}/actions:');
  expect(contract).toContain('/v1/apps/{slug}/issue-ingest-tokens:');
  expect(contract).toContain('/v1/apps/{slug}/issue-ingest-tokens/{token_id}:');
  expect(contract).toMatch(/listIssues[\s\S]*?min_customers[\s\S]*?next_cursor/);
  expect(contract).toMatch(
    /IssueDetail:[\s\S]*?next_event_cursor[\s\S]*?next_release_cursor[\s\S]*?next_activity_cursor/
  );
  expect(contract).toMatch(/IssueActionRequest:[\s\S]*?assign,resolve,reopen,ignore/);
  expect(contract).toMatch(/IssueIngestToken:[\s\S]*?token:\s*\{ type: string \}/);
});
