import { useState } from 'react';
import { Download } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { exportDebugRequests, type DebugExport, type DebugExportFormat } from '@/lib/api/debug';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InlinePhase } from './primitives';
import { windowWords } from './debug-words';

const FORMATS: [DebugExportFormat, string][] = [
  ['ndjson', 'As NDJSON (one JSON object per line)'],
  ['csv', 'As CSV (for a spreadsheet)'],
];

/**
 * Download apid's request-log export (GET .../debug/requests/export,
 * handlers_debug_export.go): metadata only, at most 10,000 rows, no bodies,
 * headers or source IPs. The file is apid's response body under apid's own
 * filename; the console only hands it to the browser. A tool, so it sits
 * behind one quiet "Export…" menu with the format as its choice.
 */
export function DebugExport({ slug, since }: { slug: string; since: string }) {
  const [last, setLast] = useState<DebugExportFormat>('ndjson');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<Pick<DebugExport, 'filename' | 'window' | 'clamped'> | null>(
    null
  );

  const run = async (format: DebugExportFormat) => {
    setLast(format);
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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="xs" variant="ghost" disabled={pending}>
            <Download aria-hidden className="h-3.5 w-3.5" />
            {pending ? 'Exporting…' : 'Export…'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Download {windowWords(since)} of requests
          </DropdownMenuLabel>
          {FORMATS.map(([format, label]) => (
            <DropdownMenuItem key={format} onSelect={() => void run(format)}>
              {label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs leading-relaxed text-muted-foreground">
            Metadata only, up to 10,000 rows: no request bodies, headers, source IPs or span
            attributes.
          </DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <div className="w-full">
          <InlinePhase phase="error" error={error} onRetry={() => void run(last)} />
        </div>
      ) : (
        done && (
          <p role="status" className="w-full text-xs text-muted-foreground">
            Downloaded {done.filename}
            {done.window && `, covering the last ${done.window}`}
            {done.clamped && ', shortened by plan retention'}.
          </p>
        )
      )}
    </>
  );
}
