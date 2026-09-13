import { Check, Clock, GitBranch, Globe, Package, Rocket } from 'iconoir-react';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import './product-previews.css';

/** Small, illustrative product views, not interactive console controls. */
function PreviewFrame({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <figure
      aria-labelledby={id}
      className="w-[15.5rem] overflow-hidden rounded-[14px] border border-border bg-card text-foreground shadow-[0_2px_3px_-1px_rgba(13,21,18,0.04),0_12px_24px_-12px_rgba(13,21,18,0.22)]"
    >
      <figcaption id={id} className="flex items-center justify-between px-3.5 pb-2 pt-3">
        <span className="text-[12px] font-semibold tracking-[-0.01em]">{title}</span>
        <span className="text-[10px] text-muted-foreground">Example</span>
      </figcaption>
      {children}
    </figure>
  );
}

export function DeploymentPreview() {
  return (
    <PreviewFrame title="Deployment">
      <div className="flex items-center justify-between px-3.5">
        <div className="flex items-center gap-2">
          <span className="text-[18px] font-medium leading-none tracking-tight">hello</span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <GitBranch aria-hidden className="size-3" />
            <span className="font-mono text-[10px]">main</span>
          </span>
        </div>
        <span
          style={{ animationDelay: '0.82s' }}
          className="preview-node flex items-center gap-1 rounded-full bg-mint-3 px-2 py-1 text-[10px] font-medium text-brand"
        >
          <Check aria-hidden className="size-3" /> Running
        </span>
      </div>
      <ol className="preview-connection relative mx-3.5 mb-3 mt-3.5 grid grid-cols-3 before:absolute before:left-[16.6667%] before:right-[16.6667%] before:top-3.5 before:h-px before:bg-mint-5">
        {[
          { Icon: GitBranch, label: 'Source', detail: '3f9c2e1' },
          { Icon: Package, label: 'Built', detail: 'bld_9k2f' },
          { Icon: Rocket, label: 'Live', detail: 'dep_4q7x' },
        ].map(({ Icon, label, detail }, index) => (
          <li key={label} className="relative z-10 flex flex-col items-center">
            <span
              style={{ animationDelay: `${0.18 + index * 0.22}s` }}
              className={cn(
                'preview-node flex size-7 items-center justify-center rounded-full ring-[4px] ring-card',
                index === 2
                  ? 'bg-brand-fill text-primary-foreground'
                  : 'bg-mint-2 text-brand ring-card'
              )}
            >
              <Icon aria-hidden className="size-3.5" />
            </span>
            <span className="mt-1.5 text-[11px] font-medium">{label}</span>
            <span className="mt-0.5 font-mono text-[9px] text-muted-foreground">{detail}</span>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-1.5 border-t border-border bg-secondary/50 px-3.5 py-2.5">
        <Globe aria-hidden className="size-3 shrink-0 text-brand" />
        <span className="font-mono text-[9.5px] tracking-tight">pr-42.hello.apps.gregale.dev</span>
      </div>
    </PreviewFrame>
  );
}

export function WakeSourcesPreview() {
  return (
    <PreviewFrame title="Wake sources">
      <ul className="space-y-2 px-3.5 pb-3">
        {[
          { Icon: Globe, label: 'Request', detail: 'GET /', value: '214 ms' },
          { Icon: Clock, label: 'Schedule', detail: '0 */6 * * *', value: 'nightly-etl' },
          { Icon: Package, label: 'Queue', detail: 'resize', value: '3 rows · dlq 0' },
        ].map(({ Icon, label, detail, value }, index) => (
          <li
            key={label}
            style={{ animationDelay: `${0.18 + index * 0.2}s` }}
            className="preview-wake-row flex items-center gap-2.5 rounded-lg"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-mint-4/60 bg-mint-2 text-brand">
              <Icon aria-hidden className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <span className="block text-[11px] font-medium leading-tight">{label}</span>
              <span className="mt-0.5 block font-mono text-[9px] leading-tight text-muted-foreground">
                {detail}
              </span>
            </div>
            <span className="font-mono text-[9px] tabular-nums text-muted-foreground">{value}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 border-t border-border bg-secondary/50 px-3.5 py-2.5 text-[10px] text-muted-foreground">
        <span aria-hidden className="size-1.5 rounded-full border border-muted-foreground/60" />
        <span>When idle</span>
        <span className="ml-auto font-medium text-foreground">No running instance</span>
      </div>
    </PreviewFrame>
  );
}

export function TracePreview({ requests = false }: { requests?: boolean }) {
  return (
    <PreviewFrame title="Wake trace">
      <div className="flex items-baseline justify-between px-3.5">
        <span className="font-mono text-[10px] text-muted-foreground">wk_2f8a</span>
        <span className="text-[22px] font-medium leading-none tracking-tight tabular-nums">
          340 <span className="text-[11px] font-normal text-muted-foreground">ms</span>
        </span>
      </div>
      <div className="px-3.5 pb-3 pt-3">
        <div
          role="img"
          aria-label="Restore: 214 ms. Other processing: 126 ms. Total: 340 ms."
          className="flex h-3 gap-[3px] overflow-hidden rounded-[4px]"
        >
          <span
            className="preview-trace-bar h-full rounded-[3px] bg-[linear-gradient(90deg,var(--mint-6),var(--brand-fill))]"
            style={{ flex: 214 }}
          />
          <span
            className="preview-trace-bar h-full rounded-[3px] bg-border-secondary"
            style={{ flex: 126, animationDelay: '0.36s' }}
          />
        </div>
        <div className="mt-2 flex justify-between text-[10px] leading-none">
          <span className="text-brand">
            Restore <span className="font-mono tabular-nums">214 ms</span>
          </span>
          <span className="text-muted-foreground">
            Other <span className="font-mono tabular-nums">126 ms</span>
          </span>
        </div>
      </div>
      {requests && (
        <div className="border-t border-border bg-secondary/40 px-3.5 pb-1.5 pt-1">
          <table
            aria-label="Example requests"
            className="w-full border-collapse text-left text-[10px]"
          >
            <thead className="sr-only">
              <tr>
                <th scope="col">Request</th>
                <th scope="col">Status</th>
                <th scope="col">Duration</th>
              </tr>
            </thead>
            <tbody>
              {[
                { app: 'hello', route: 'GET /', duration: '340 ms' },
                { app: 'image-resize', route: 'POST /resize', duration: '212 ms' },
              ].map(({ app, route, duration }, index) => (
                <tr
                  key={app}
                  style={{ animationDelay: `${0.65 + index * 0.18}s` }}
                  className="preview-wake-row border-b border-border/70 last:border-0"
                >
                  <td className="py-1.5">
                    <span className="block font-medium leading-tight">{app}</span>
                    <span className="mt-0.5 block font-mono text-[9px] leading-tight text-muted-foreground">
                      {route}
                    </span>
                  </td>
                  <td className="text-right">
                    <span className="rounded bg-mint-3 px-1 py-0.5 font-mono text-[9px] text-brand">
                      200
                    </span>
                  </td>
                  <td className="whitespace-nowrap pl-2 text-right font-mono text-[9px] tabular-nums text-muted-foreground">
                    {duration}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PreviewFrame>
  );
}
