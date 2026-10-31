import type { StreamStatus } from '@/lib/api/logs';
import { Button } from '@/components/ui/button';

/** Kept outside the log buffer so recovery stays visible when old lines exist. */
export function LogStreamRecovery({
  status,
  reason,
  canRetry,
  retry,
}: {
  status: StreamStatus;
  reason?: string;
  canRetry: boolean;
  retry: () => void;
}) {
  if (status === 'reconnecting') {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Connection interrupted. Reconnecting automatically…
      </p>
    );
  }
  if (status !== 'error') return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span>
        {reason ? (
          <>
            The stream stopped: <span className="font-mono">{reason}</span>
          </>
        ) : (
          'The log stream disconnected. Automatic recovery could not reconnect.'
        )}
      </span>
      {canRetry && (
        <Button size="sm" variant="outline" onClick={retry}>
          Retry log stream
        </Button>
      )}
    </div>
  );
}
