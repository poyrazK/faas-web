import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useAddDomain, useCreateCron } from '@/lib/api/queries';
import { useCreateObjectBucket } from '@/lib/api/object-storage';
import { Button } from '@/components/ui/button';
import {
  createErrorMessage,
  validateBucketName,
  validateCron,
  validateHostname,
  type CreateKind,
} from './create';

/**
 * The draft is the confirmation step: it already says what will be created
 * and where. ↵ commits, esc dissolves. Single-field creates type straight
 * in; a cron grows into a compact form in place.
 */
type DraftProps = {
  kind: CreateKind;
  app: { slug: string; id: string; defaultRegion?: string };
  onDone: () => void;
  onCancel: () => void;
};

export function DraftNode({ kind, app, onDone, onCancel }: DraftProps) {
  const domain = useAddDomain();
  const cron = useCreateCron();
  const bucket = useCreateObjectBucket(app.slug);
  const active = kind === 'domain' ? domain : kind === 'cron' ? cron : bucket;
  const [value, setValue] = useState('');
  const [schedule, setSchedule] = useState('');
  const [path, setPath] = useState('/');
  const [invalid, setInvalid] = useState<string>();
  const error = invalid ?? (active.error ? createErrorMessage(active.error) : undefined);
  const done = { onSuccess: onDone };

  // React Flow mounts a node hidden until it has been measured, so
  // `autoFocus` lands on an invisible input and focus falls to <body>.
  // Two frames is after the measure pass and before anyone types.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => inputRef.current?.focus());
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);

  const submit = () => {
    if (active.isPending) return;
    if (kind === 'domain') {
      const host = value.trim().toLowerCase();
      const problem = validateHostname(host);
      setInvalid(problem);
      if (!problem) domain.mutate({ domain: host, app_id: app.id }, done);
    } else if (kind === 'bucket') {
      const problem = validateBucketName(value);
      setInvalid(problem);
      if (!problem) bucket.mutate({ name: value, region: app.defaultRegion }, done);
    } else {
      const problem = validateCron({ schedule, path });
      setInvalid(problem);
      if (!problem)
        cron.mutate({ app_id: app.id, schedule: schedule.trim(), path: path || '/' }, done);
    }
  };

  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  const field =
    'h-8 w-full rounded-[var(--console-control-radius)] border border-input bg-background px-2.5 text-[13px] outline-none focus:border-brand focus:ring-[3px] focus:ring-brand-muted';

  return (
    <div
      className="nodrag nopan w-[230px] animate-item-enter rounded-[10px] border border-dashed border-brand/60 bg-canvas-glass p-2.5 shadow-elevation-2 backdrop-blur-md"
      onKeyDown={keys}
    >
      <p className="label-mono text-[10.5px] text-brand">New {kind}</p>
      <p className="mb-2 text-[11px] text-muted-foreground">→ creates on {app.slug}</p>
      {kind === 'cron' ? (
        <div className="flex flex-col gap-2">
          <label className="text-[11px] text-muted-foreground">
            Schedule
            <input
              ref={inputRef}
              aria-label="Schedule"
              className={`${field} font-mono`}
              placeholder="0 3 * * *"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
            />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Path
            <input
              aria-label="Path"
              className={`${field} font-mono`}
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
          </label>
          <p className="text-[11px] text-muted-foreground">Times are UTC.</p>
          <div className="flex justify-end gap-1.5">
            <Button size="xs" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="xs" onClick={submit} disabled={active.isPending}>
              Create cron
            </Button>
          </div>
        </div>
      ) : (
        <input
          ref={inputRef}
          aria-label={kind === 'domain' ? 'Hostname' : 'Bucket name'}
          className={field}
          placeholder={kind === 'domain' ? 'api.example.com' : 'orders'}
          value={value}
          disabled={active.isPending}
          onChange={(e) => setValue(e.target.value)}
        />
      )}
      {error ? (
        <p role="alert" className="mt-1.5 text-[11px] text-status-critical">
          {error}
        </p>
      ) : (
        kind !== 'cron' && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">↵ create · esc cancel</p>
        )
      )}
    </div>
  );
}

/** The draft as a React Flow node, so a real marching edge can reach it. */
export function DraftFlowNode({ data }: NodeProps<Node<DraftProps, 'draft'>>) {
  return (
    <>
      <Handle id="in" type="target" position={Position.Left} isConnectable={false} />
      <DraftNode {...data} />
      <Handle id="out" type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}
