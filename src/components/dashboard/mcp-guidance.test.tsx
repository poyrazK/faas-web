import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { McpGuidance } from './mcp-guidance';

const state = vi.hoisted(() => ({
  mcp: 'available',
  streaming: 'available',
  app: {
    accountId: 'account-a',
    appId: 'app-a',
    slug: 'api-gateway',
    streamingEnabled: true,
    visibility: 'public',
    executionMode: 'request',
    publicUrl: 'https://app.example.test/',
  },
  error: null as Error | null,
  fetching: false,
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: (key: string) => ({
    accountId: 'account-a',
    state: key === 'mcp-hosting' ? state.mcp : state.streaming,
    capability: { maturity: 'preview', docs_url: '/docs/mcp' },
    refresh: vi.fn(),
  }),
}));
vi.mock('@/lib/api/mcp-app', () => ({
  useMcpApp: () => ({
    data: state.app,
    error: state.error,
    isPending: false,
    isFetching: state.fetching,
    refetch: vi.fn(),
  }),
}));
beforeEach(() => {
  state.mcp = 'available';
  state.streaming = 'available';
  state.app = {
    accountId: 'account-a',
    appId: 'app-a',
    slug: 'api-gateway',
    streamingEnabled: true,
    visibility: 'public',
    executionMode: 'request',
    publicUrl: 'https://app.example.test/',
  };
  state.error = null;
  state.fetching = false;
});
it('provides client/auth/catalog guidance with explicit unverified protocol status and no diagnostic execution', () => {
  render(<McpGuidance slug="api-gateway" />);
  expect(screen.getByText('https://app.example.test/mcp', { exact: true })).toBeVisible();
  expect(screen.getByText(/Protocol and catalog health remain unverified/)).toBeVisible();
  expect(screen.getByText(/gregale mcp doctor --app api-gateway/)).toBeVisible();
  expect(screen.getAllByText(/MCP_TOKEN/).length).toBeGreaterThan(0);
  expect(
    screen.queryByRole('button', { name: /run|probe|verify protocol/i })
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Documentation' })).not.toBeInTheDocument();
});
it.each(['registry-error', 'plan-not-entitled', 'runtime-unavailable', 'loading'])(
  'does not show endpoint-ready guidance when MCP capability is %s',
  (mcp) => {
    state.mcp = mcp;
    render(<McpGuidance slug="api-gateway" />);
    expect(
      screen.queryByText('https://app.example.test/mcp', { exact: true })
    ).not.toBeInTheDocument();
    expect(screen.getByText(/CLI account credentials.*control plane/)).toBeVisible();
  }
);
it('requires streaming registry availability and fresh app configuration', () => {
  state.streaming = 'runtime-unavailable';
  const view = render(<McpGuidance slug="api-gateway" />);
  expect(
    screen.queryByText('https://app.example.test/mcp', { exact: true })
  ).not.toBeInTheDocument();
  state.streaming = 'available';
  state.app.streamingEnabled = false;
  view.rerender(<McpGuidance slug="api-gateway" />);
  expect(screen.getByText(/Streaming is disabled on this app/)).toBeVisible();
});
it.each(['worker', 'job'])('does not offer an HTTP MCP endpoint for %s execution', (mode) => {
  state.app.executionMode = mode;
  render(<McpGuidance slug="api-gateway" />);
  expect(
    screen.queryByText('https://app.example.test/mcp', { exact: true })
  ).not.toBeInTheDocument();
  expect(screen.getByText(/MCP hosting needs an HTTP application/)).toBeVisible();
});
it('keeps permission/read errors and refreshing metadata distinct from a usable endpoint', () => {
  state.error = new Error('Fixture MFA read denied');
  const view = render(<McpGuidance slug="api-gateway" />);
  expect(screen.getByText('Fixture MFA read denied', { exact: true })).toBeVisible();
  expect(
    screen.queryByText('https://app.example.test/mcp', { exact: true })
  ).not.toBeInTheDocument();
  state.error = null;
  state.fetching = true;
  view.rerender(<McpGuidance slug="api-gateway" />);
  expect(
    screen.queryByText('https://app.example.test/mcp', { exact: true })
  ).not.toBeInTheDocument();
});
it('does not turn an internal app address into a public connection URL', () => {
  state.app.visibility = 'internal';
  render(<McpGuidance slug="api-gateway" />);
  expect(
    screen.queryByText('https://app.example.test/mcp', { exact: true })
  ).not.toBeInTheDocument();
  expect(screen.getByText(/Internal routing.*authorized client/)).toBeVisible();
});
