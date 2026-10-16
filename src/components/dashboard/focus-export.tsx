import { useState } from 'react';
import { Download } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/field';
import { api, unwrap } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import { cn } from '@/lib/utils';
import { Panel } from './primitives';

type Format = 'zip' | 'csv' | 'metadata';
const FORMATS: { value: Format; label: string; extension: string }[] = [
  { value: 'zip', label: 'ZIP (CSV + metadata)', extension: 'zip' },
  { value: 'csv', label: 'CSV only', extension: 'csv' },
  { value: 'metadata', label: 'Metadata only', extension: 'json' },
];

/** The previous UTC month as YYYY-MM: the latest period with a closed invoice. */
export function previousMonth(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Invoice detail as a FOCUS 1.4 projection, for cost tools that read FOCUS.
 * apid calls it partial, and so does this panel: it covers invoices persisted
 * for the month (by period end), excludes drafts and voids, and never
 * substitutes current prices.
 */
export function FocusExport() {
  const [month, setMonth] = useState(previousMonth);
  const [format, setFormat] = useState<Format>('zip');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);

  const download = async () => {
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      const blob = await unwrap(
        api.GET('/v1/billing/focus', {
          params: { query: { month, format } },
          parseAs: 'blob',
        })
      );
      const extension = FORMATS.find((f) => f.value === format)!.extension;
      const url = URL.createObjectURL(blob as Blob);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = `gregale-focus-${month}.${extension}`;
        link.click();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel
      title="Cost export"
      description="Invoice detail as a FOCUS 1.4 projection for cost tools. Partial: it covers invoices whose period ends in the month, without drafts or voids."
    >
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void download();
        }}
      >
        <label className="flex flex-col gap-1.5 text-xs font-medium">
          Month
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className={cn(FIELD, 'w-40')}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium">
          Format
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value as Format)}
            className={cn(FIELD, 'w-52')}
          >
            {FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="gap-1.5"
          busy={pending}
          disabled={!valid}
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>
        {error && (
          <p role="alert" className="w-full text-sm text-[color:var(--status-critical)]">
            {error}
          </p>
        )}
      </form>
    </Panel>
  );
}
