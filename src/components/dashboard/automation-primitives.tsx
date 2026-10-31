import { CheckCircle, Circle, Pause, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';

export function AutomationStatus({ status }: { status: string }) {
  const good = ['succeeded', 'published', 'enabled'].includes(status);
  const failed = ['failed', 'dead'].includes(status);
  const Icon = good ? CheckCircle : failed ? WarningTriangle : status === 'paused' ? Pause : Circle;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs"
      style={{
        color: good
          ? 'var(--status-good)'
          : failed
            ? 'var(--status-critical)'
            : 'var(--muted-foreground)',
      }}
    >
      <Icon className="h-3.5 w-3.5" />
      {status.replaceAll('_', ' ')}
    </span>
  );
}

export function Pagination({
  offset,
  total,
  busy,
  onChange,
}: {
  offset: number;
  total: number;
  busy: boolean;
  onChange: (offset: number) => void;
}) {
  if (total <= 25 && offset === 0) return null;
  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">
        {offset + 1}–{Math.min(offset + 25, total)} of {total}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || offset === 0}
          onClick={() => onChange(Math.max(0, offset - 25))}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || offset + 25 >= total}
          onClick={() => onChange(offset + 25)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
