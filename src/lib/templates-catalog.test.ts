import { describe, expect, it } from 'vitest';
import { CATEGORY_LABEL, deployCommand, groupTemplates } from './templates-catalog';

describe('groupTemplates', () => {
  it('groups by category in the spec order and keeps within-group order', () => {
    const grouped = groupTemplates([
      { name: 'ai-chat', category: 'ai', description: 'a' },
      { name: 'hello-node', category: 'hello', description: 'b' },
      { name: 'hello-go', category: 'hello', description: 'c' },
    ]);
    expect(grouped.map(([c]) => c)).toEqual(['hello', 'ai']);
    expect(grouped[0][1].map((t) => t.name)).toEqual(['hello-node', 'hello-go']);
  });

  it('labels every category and builds the CLI command', () => {
    expect(Object.keys(CATEGORY_LABEL)).toEqual(['hello', 'function', 'stateless-contract', 'ai']);
    expect(deployCommand('slack-bot')).toBe('gregale deploy --template slack-bot');
  });
});
