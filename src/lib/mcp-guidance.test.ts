import { expect, it } from 'vitest';
import { mcpCommands, mcpEndpoint } from './mcp-guidance';
it('generates explicit CLI diagnostics and definition-only catalog handoffs without tool execution', () => {
  const commands = mcpCommands('api-gateway');
  expect(commands.tools).toBe('gregale mcp tools --app api-gateway --token-env MCP_TOKEN');
  expect(commands.doctor).toBe('gregale mcp doctor --app api-gateway --token-env MCP_TOKEN');
  expect(commands.config).toBe('gregale mcp config --app api-gateway --name api-gateway');
  expect(Object.values(commands).join('\n')).not.toMatch(
    /stream-tool|mcp call|resource-read|prompt-get/
  );
});
it('rejects shell injection and credential-bearing endpoint paths', () => {
  expect(() => mcpCommands('a; echo secret')).toThrow();
  expect(mcpEndpoint('https://app.example.test', '/custom/mcp')).toBe(
    'https://app.example.test/custom/mcp'
  );
  for (const path of [
    '//another.example/mcp',
    '/mcp?token=secret',
    '/mcp#token',
    '/mcp%3ftoken',
    '/mcp secret',
  ])
    expect(mcpEndpoint('https://app.example.test', path)).toBeUndefined();
});
