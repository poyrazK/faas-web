export function safeMcpBase(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 2048) return;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return;
    return url.href;
  } catch {
    return;
  }
}

export function mcpEndpoint(base: string, path: string): string | undefined {
  const safe = safeMcpBase(base);
  if (!safe || !/^\/[A-Za-z0-9/_-]*$/.test(path) || path.startsWith('//') || path.length > 1024)
    return;
  return new URL(path, safe).href;
}

export function mcpCommands(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) throw new Error('Unconfirmed app identity.');
  const remote = `--app ${slug} --token-env MCP_TOKEN`;
  return {
    doctor: `gregale mcp doctor ${remote}`,
    config: `gregale mcp config --app ${slug} --name ${slug}`,
    tools: `gregale mcp tools ${remote}`,
    resources: `gregale mcp resources ${remote}`,
    prompts: `gregale mcp prompts ${remote}`,
  };
}
