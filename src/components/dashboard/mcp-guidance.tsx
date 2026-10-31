import { Button } from '@/components/ui/button';
import { CopyIconButton } from '@/components/ui/copy-button';
import { useCapability } from '@/lib/api/capabilities';
import { useMcpApp } from '@/lib/api/mcp-app';
import { errorMessage } from '@/lib/api/errors';
import { mcpCommands, mcpEndpoint } from '@/lib/mcp-guidance';
import { Panel } from './primitives';
import { CapabilityNotice } from './capability-notice';

function Command({ label, command }: { label: string; command: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">{label}</p>
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2">
        <code className="min-w-0 flex-1 break-all text-xs">{command}</code>
        <CopyIconButton text={command} label={label} />
      </div>
    </div>
  );
}
export function McpGuidance({ slug }: { slug: string }) {
  const mcp = useCapability('mcp-hosting');
  const streaming = useCapability('streaming-and-grpc');
  const metadata = useMcpApp(mcp.accountId, slug);
  const app =
    !metadata.error &&
    !metadata.isPending &&
    !metadata.isFetching &&
    metadata.data?.accountId === mcp.accountId &&
    metadata.data.slug === slug
      ? metadata.data
      : undefined;
  let commands: ReturnType<typeof mcpCommands> | undefined;
  try {
    commands = mcpCommands(slug);
  } catch {
    /* Unconfirmed route identities never enter shell handoffs. */
  }
  const executionBlocked = app?.executionMode === 'worker' || app?.executionMode === 'job';
  const ready =
    mcp.state === 'available' &&
    streaming.state === 'available' &&
    mcp.accountId === streaming.accountId &&
    app?.streamingEnabled === true &&
    app.visibility === 'public' &&
    !executionBlocked;
  const endpoint = ready && app.publicUrl ? mcpEndpoint(app.publicUrl, '/mcp') : undefined;
  return (
    <Panel
      title="MCP hosting"
      description="Preview · deployment and client guidance for stateless Streamable HTTP servers."
    >
      <div className="space-y-5 p-4 text-sm">
        <CapabilityNotice capability={mcp.capability} state={mcp.state} onRetry={mcp.refresh} />
        <div className="space-y-1">
          <p className="font-medium">Streaming availability</p>
          <CapabilityNotice
            capability={streaming.capability}
            state={streaming.state}
            onRetry={streaming.refresh}
          />
        </div>
        <p>
          Registry availability and app configuration do not verify MCP. Protocol and catalog health
          remain unverified until you inspect explicit CLI diagnostic results.
        </p>
        {metadata.error ? (
          <p role="alert">{errorMessage(metadata.error)}</p>
        ) : metadata.isPending || metadata.isFetching ? (
          <p role="status">Reading current app configuration…</p>
        ) : !app ? (
          <p role="status">App metadata is unconfirmed. Refresh the current account and app.</p>
        ) : (
          <div className="space-y-2">
            <p className="break-all text-xs text-muted-foreground">
              App {app.slug} · exact ID {app.appId}
            </p>
            {app.streamingEnabled === false ? (
              <p role="status">
                Streaming is disabled on this app. Review the streaming setting in Configuration
                before using the MCP hosting profile.
              </p>
            ) : app.streamingEnabled !== true ? (
              <p role="status">
                Streaming configuration was not returned. Availability remains unconfirmed.
              </p>
            ) : null}
            {executionBlocked && (
              <p role="status">
                MCP hosting needs an HTTP application; workers and Jobs have no HTTP ingress.
              </p>
            )}
            {app.visibility === 'internal' && (
              <p role="status">
                Internal routing requires an authorized client and a reviewed reachable transport.
                No public connection URL is inferred.
              </p>
            )}
            {endpoint ? (
              <div className="space-y-2">
                <p className="font-medium">Starter-default endpoint · confirm gregale-mcp.json</p>
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 break-all text-xs">{endpoint}</code>
                  <CopyIconButton text={endpoint} label="Starter-default MCP endpoint" />
                </div>
                <p className="text-xs text-muted-foreground">
                  The default path is /mcp. For a custom declared path, add --endpoint /custom/path
                  to the CLI handoffs below. This address has not been probed.
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">
                Endpoint guidance requires current MCP and streaming availability, a
                streaming-enabled public HTTP app, and a safe returned URL.
              </p>
            )}
          </div>
        )}
        <Button variant="outline" onClick={() => void metadata.refetch()}>
          Refresh app configuration
        </Button>
        <section className="space-y-2" aria-label="MCP deployment guidance">
          <h3 className="font-medium">Deployment and authentication</h3>
          <p>
            Use an ordinary HTTP application with stateless Streamable HTTP. Stateless legacy
            compatibility is optional; direct stdio hosting and stateful sessions need a separately
            qualified adapter.
          </p>
          <Command label="Create a local MCP starter" command="gregale mcp init --path ./my-mcp" />
          <p className="text-xs">
            Inspect gregale.yaml and gregale-mcp.json, then use gregale mcp deploy from the reviewed
            source directory. The CLI stages zero production traffic and may promote after
            verification; review the target app before executing it.
          </p>
          <p>
            Starters begin with public open access and reject browser origins by default. Configure
            external OAuth and caller ownership/scopes for private data. Provider and client
            interoperability require qualification.
          </p>
          <p>
            CLI account credentials authenticate only to the Gregale control plane. For
            authenticated MCP diagnostics and catalogs, supply a client access token through the
            MCP_TOKEN environment variable; --token-env MCP_TOKEN reads it without embedding it in
            the command. Omit that flag for an intentionally open endpoint.
          </p>
        </section>
        <section className="space-y-3" aria-label="MCP client and catalog handoffs">
          <h3 className="font-medium">Client and catalog handoffs</h3>
          <p>
            Run these commands explicitly in your terminal. The console reads app metadata only.
            Doctor and catalog discovery are CLI operations; the console executes no probes or
            tools.
          </p>
          {commands ? (
            <>
              <Command label="Inspect protocol with the CLI" command={commands.doctor} />
              <Command
                label="Generate credential-free client configuration"
                command={commands.config}
              />
              <Command label="List tool definitions" command={commands.tools} />
              <Command label="List resource definitions" command={commands.resources} />
              <Command label="List prompt definitions" command={commands.prompts} />
            </>
          ) : (
            <p role="alert">The app identity is unconfirmed; commands are unavailable.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Connection JSON contains no credentials and uses a common mcpServers HTTP shape; adapt
            it to your client. Resource reads, prompt rendering and tool calls are separate explicit
            actions. If clipboard access is unavailable, select and copy the visible command
            manually. Run gregale mcp --help for local reference.
          </p>
        </section>
      </div>
    </Panel>
  );
}
