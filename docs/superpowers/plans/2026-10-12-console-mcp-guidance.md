# MCP Hosting Guidance Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Steps use checkboxes for tracking.

**Goal:** Provide app-scoped MCP deployment, client/auth and catalog guidance with truthful availability and no browser diagnostic execution.

**Architecture:** The Connect section gets an MCP tab. Fresh account-scoped whitelisted app metadata and registry MCP/streaming capabilities determine whether endpoint guidance is available. CLI operations remain explicit handoffs; no protocol verification is inferred from metadata.

**Tech Stack:** React, TypeScript, TanStack Query/Router, Vitest, existing console components and Vite mock API.

**Spec:** Approved console capability plan L2; faas-web#156. Backend contract/docs pin `15a8415ea48821b71e8551cb8a19ca0d0f61dd5e`; frontend base J `26e6234aa3d3d40281529684fc8cba86421d208c`.

## Global constraints

- Inline execution, atomic scoped commits and one bounded PR based on J; no merges, providers, live probes or tool execution.
- Preserve app-centered navigation and the existing design system. User declined brainstorming and explicitly authorized remaining inline implementation; this plan records necessary execution details under that approved scope.
- MCP hosting is Preview, Hobby+; also require `streaming-and-grpc` availability and returned app streaming configuration. Neither configuration nor registry proves protocol, provider interoperability or execution health.
- All reads are abortable and account/app scoped. Whitelist before caching; retain no tokens, credential-bearing URLs or raw response fields. Account changes and failed refreshes cannot present another context as verified.
- Use backend docs/mcp.md commands. No invented diagnostic endpoint, automatic browser probe, unsupported local docs URL or token input.

## Review focus

1. Failed capability refresh with last-good data: hide endpoint-ready guidance and explain unconfirmed availability.
2. Delayed reads across account/app changes: reject mismatched identity and scope caches separately.
3. Streaming-disabled, internal and worker apps: explain the missing HTTP prerequisite without claiming protocol health.
4. Credential-bearing or malformed returned URLs/metadata: omit unsafe URLs and strip unexpected secret fields.
5. Client/auth/catalog handoffs: expose environment-variable token guidance and read-only catalog commands without executing them or promising client-specific compatibility.

## Task 1: Safe metadata and guide behavior

**Files:** `src/lib/api/mcp-app.ts`, `src/lib/api/mcp-app.test.tsx`, `src/lib/mcp-guidance.ts`, `src/lib/mcp-guidance.test.ts`.

**Interfaces:** `readMcpApp(accountId, slug, signal)` returns `{accountId, appId, slug, streamingEnabled?, executionMode?, visibility?, publicUrl?}`; `useMcpApp` uses `['account', accountId, 'app', slug, 'mcp-guidance']`. `mcpCommands(slug)` returns doctor/config/tools/resources/prompts commands using `--app` and `--token-env MCP_TOKEN`. No raw server response enters query caches.

- [ ] Write behavioral tests for identity/secret projection, abort and account change, safe URLs, command validity and unsupported app identity; observe RED.

```ts
expect(mcpCommands('api-gateway').tools).toBe(
  'gregale mcp tools --app api-gateway --token-env MCP_TOKEN'
);
expect(await readMcpApp('account-a', 'api-gateway', signal)).not.toHaveProperty('signing_secret');
```

- [ ] Implement fresh account check before/after the app read, strict identity projection and HTTPS URL validation (no credentials/query/fragment). Model missing configuration as unverified, not enabled. Run focused tests/typecheck, then commit the client/behavior.

## Task 2: Connect tab and verification

**Files:** `src/components/dashboard/mcp-guidance.tsx`, corresponding tests, `app-tab-navigation.tsx`, `dashboard.workflows.$workflowId.tsx`, `capability-entrypoints.ts`, `mock/capabilities.ts`.

**Interface:** `<McpGuidance slug={workflowId} />` reads both registry entries and scoped metadata. Static deployment/auth/catalog guidance remains visible in unavailable/error states; endpoint/client instructions require the fresh prerequisites. Optional path selection is local component state only; no credentials accepted or stored.

- [ ] RED tests for capability failure/denial, streaming disabled, read/MFA failure, empty metadata, worker/internal app, safe client/auth guidance and absent published docs route.
- [ ] Add MCP within Connect, preserving URL tab selection/history; add a real capability destination. Explain stateless Streamable HTTP, optional stateless legacy compatibility, endpoint defaults, public-open starter access and external OAuth ownership. `doctor/config/tools/resources/prompts` are CLI operations; tool calls/resource reads/prompt rendering are separate actions.

```tsx
{
  tab === 'MCP' && <McpGuidance key={workflowId} slug={workflowId} />;
}
```

- [ ] Focused GREEN/typecheck, atomic UI commit, full check/build and mobile/keyboard/reload/history/delayed-context walkthrough with zero diagnostic writes/probes.
- [ ] One fresh GPT-6.1 Sol/High final reviewer; fix Important/Critical findings RED→GREEN. Push/open bounded PR, attach, update #156/#134 and durable handoff honestly. No merge.

## Self-review

Approved L2 requirements map to these two tasks. This deliverable is explicitly guidance supported by actual metadata; it does not create a diagnostic API or claim MCP runtime qualification. No new consequential product authority is required.
