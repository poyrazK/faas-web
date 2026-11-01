import { CopyButton } from '@/components/docs/copy-button';
import { Markdown } from '@/components/docs/markdown';
import { curlFor, type ApiField, type ApiOperation } from '@/lib/api-reference/build';
import { cn } from '@/lib/utils';

export function MethodLabel({ method, className }: { method: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex w-16 shrink-0 justify-center rounded border px-1.5 py-0.5 font-mono text-[11px] font-medium',
        method === 'DELETE'
          ? 'border-destructive/40 text-destructive'
          : method === 'GET'
            ? 'border-border text-muted-foreground'
            : 'border-brand/40 text-brand',
        className
      )}
    >
      {method}
    </span>
  );
}

/** Field descriptions are plain prose with `backtick` spans; show those as code. */
function Prose({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`\n]+`)/).map((part, index) =>
        part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
          <code key={index} className="font-mono text-[12px] text-foreground">
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        )
      )}
    </>
  );
}

function Fields({ title, fields }: { title: string; fields: ApiField[] }) {
  if (!fields.length) return null;
  return (
    <section className="mt-5">
      <h4 className="label-mono text-muted-foreground">{title}</h4>
      <dl className="mt-2 divide-y divide-border rounded-lg border border-border">
        {fields.map((field) => (
          <div key={`${field.in ?? 'body'}-${field.name}`} className="px-3 py-2.5">
            <dt className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <code className="font-mono text-[13px] font-medium">{field.name}</code>
              <span className="font-mono text-xs text-muted-foreground">{field.type}</span>
              {field.in && <span className="text-xs text-muted-foreground">{field.in}</span>}
              {field.required && <span className="text-xs text-brand">required</span>}
            </dt>
            {(field.description || field.values) && (
              <dd className="mt-1 text-[13px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                {field.description && <Prose text={field.description} />}
                {field.values && (
                  <span className="mt-1 block font-mono text-xs">
                    One of: {field.values.join(', ')}
                  </span>
                )}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border bg-muted/40">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="label-mono text-muted-foreground">{label}</span>
        <CopyButton text={code} label="Copy" className="label-mono" />
      </div>
      <pre className="max-h-80 overflow-auto p-3 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** One operation: what it does, what to send, what comes back, and a curl to try it. */
export function ApiOperationSection({ operation }: { operation: ApiOperation }) {
  const success = operation.responses.find((response) => response.example);
  return (
    <section
      id={operation.id}
      className="scroll-mt-24 border-t border-border pt-8 first:border-t-0"
    >
      <h3 className="text-lg font-semibold tracking-tight">
        <a href={`#${operation.id}`} className="hover:underline">
          {operation.summary}
        </a>
        {operation.deprecated && (
          <span className="ml-2 align-middle text-xs font-normal text-muted-foreground">
            Deprecated
          </span>
        )}
      </h3>
      <div className="mt-3 flex min-w-0 items-center gap-2">
        <MethodLabel method={operation.method} />
        <code className="min-w-0 font-mono text-[13px] [overflow-wrap:anywhere]">
          {operation.path}
        </code>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Authentication: {operation.auth}</p>
      {operation.description && (
        <div className="mt-4 text-sm">
          <Markdown source={operation.description} />
        </div>
      )}

      <Fields title="Parameters" fields={operation.params} />
      {operation.body && (
        <>
          {operation.body.description && (
            <p className="mt-5 text-[13px] text-muted-foreground">
              <Prose text={operation.body.description} />
            </p>
          )}
          <Fields
            title={operation.body.required ? 'Request body' : 'Request body (optional)'}
            fields={operation.body.fields}
          />
        </>
      )}

      <CodeBlock label="Request" code={curlFor(operation)} />

      <section className="mt-5">
        <h4 className="label-mono text-muted-foreground">Responses</h4>
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
          {operation.responses.map((response) => (
            <li key={response.status} className="flex gap-3 px-3 py-2 text-[13px]">
              <span
                className={cn(
                  'w-10 shrink-0 font-mono',
                  response.status.startsWith('2') ? 'text-brand' : 'text-muted-foreground'
                )}
              >
                {response.status}
              </span>
              <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
                <Prose text={response.description} />
              </span>
            </li>
          ))}
        </ul>
        {success?.example && (
          <CodeBlock label={`Example ${success.status} response`} code={success.example} />
        )}
      </section>
    </section>
  );
}
