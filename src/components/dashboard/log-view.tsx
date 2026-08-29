import { useEffect, useRef } from 'react';
import { LevelTag } from './primitives';
import type { LogLine } from '@/lib/api/logs';
import { cn } from '@/lib/utils';

/**
 * A read-only log surface: timestamp, level, message.
 *
 * The Logs page keeps its own viewport because it also owns following,
 * jump-to-live, and the buffer controls. This is the quieter version, for
 * places that show a finite log and nothing else — a build, so far.
 */
export function LogView({
  lines,
  className,
  autoScroll = true,
}: {
  lines: LogLine[];
  className?: string;
  autoScroll?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoScroll && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines, autoScroll]);

  return (
    <div
      ref={ref}
      role="log"
      aria-label="Build output"
      className={cn('overflow-y-auto rounded-md border border-border bg-background p-3', className)}
    >
      {lines.map((line) => (
        // content-visibility lets the browser skip layout and paint for
        // offscreen lines — the cheap version of virtualization, with the
        // intrinsic size keeping the scrollbar honest.
        <p
          key={line.id}
          className="flex gap-3 font-mono text-xs leading-relaxed [contain-intrinsic-block-size:auto_1.25rem] [content-visibility:auto]"
        >
          <span className="shrink-0 select-none text-muted-foreground">
            {new Date(line.ts).toLocaleTimeString()}
          </span>
          {line.level ? (
            <LevelTag level={line.level} />
          ) : (
            <span aria-hidden className="w-14 shrink-0" />
          )}
          <span className="min-w-0 whitespace-pre-wrap break-all">{line.text}</span>
        </p>
      ))}
    </div>
  );
}
