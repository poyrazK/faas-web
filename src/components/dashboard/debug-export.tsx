import { useState } from 'react';
import { Download } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { exportDebugRequests, type DebugExport, type DebugExportFormat } from '@/lib/api/debug';
import { InlinePhase } from './primitives';

/**
 * Download apid's request-log export (GET .../debug/requests/export,
 * handlers_debug_export.go): metadata only, at most 10,000 rows, no bodies,
 * headers or source IPs. The file is apid's response body under apid's own
 * filename; the console only hands it to the browser.
 */
export function DebugExport({ slug, since }: { slug: string; since: string }) {
  const [format, setFormat] = useState<DebugExportFormat>('ndjson');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<Pick<DebugExport, 'filename' | 'window' | 'clamped'> | null>(
    null
  );

  const run = async () => {
    setPending(true);
    setError(null);
    setDone(null);
    try {
      const file = await exportDebugRequests(slug, { since, format });
      const url = URL.createObjectURL(file.blob);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = file.filename;
        link.click();
      } finally {
        URL.revokeObjectURL(url);
      }
      setDone({ filename: file.filename, window: file.window, clamped: file.clamped });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <label className="flex items-center gap-2">
          Export format
          <select
            aria-label="Export format"
            value={format}
            onChange={(e) => setFormat(e.target.value as DebugExportFormat)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="ndjson">NDJSON</option>
            <option value="csv">CSV</option>
          </select>
        </label>
        <Button size="xs" variant="outline" disabled={pending} onClick={() => void run()}>
          <Download aria-hidden className="h-3.5 w-3.5" />
          {pending ? 'Exporting…' : `Export ${since} of requests`}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Metadata only, up to 10,000 rows: no request bodies, headers, source IPs or span attributes.
      </p>
      {error ? (
        <InlinePhase phase="error" error={error} onRetry={() => void run()} />
      ) : (
        done && (
          <p role="status" className="text-xs text-muted-foreground">
            Downloaded {done.filename}
            {done.window && `, covering the last ${done.window}`}
            {done.clamped && ', shortened by plan retention'}.
          </p>
        )
      )}
    </div>
  );
}
