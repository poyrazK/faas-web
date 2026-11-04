import { useState, type FormEvent } from 'react';
import { CheckCircle, RefreshDouble, WarningTriangle } from 'iconoir-react';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { SegmentedControl } from '@/components/dashboard/tabs';
import { Button } from '@/components/ui/button';
import { CopyableId } from '@/components/ui/copyable-id';
import { FIELD } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { formatUsageBytes } from '@/lib/usage-format';
import { cn } from '@/lib/utils';
import {
  useWriteReceipt,
  useWriteReceipts,
  type ObjectBucket,
  type ReceiptStatus,
  type WriteReceipt,
} from '@/lib/api/object-storage';
import { StatusChip } from './status-chip';

const STATUSES: readonly { key: ReceiptStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
  { key: 'all', label: 'All' },
];

const OPERATION: Record<WriteReceipt['operation'], string> = {
  put: 'Upload',
  copy: 'Copy',
  upload: 'Upload route',
};

/** What a failed or uncertain write means, by apid's `error_code`. */
const ERROR: Record<NonNullable<WriteReceipt['error_code']>, string> = {
  preparation_expired: 'The upload was never sent before its URL expired.',
  usage_unavailable: 'Storage accounting was unavailable, so the write was not admitted.',
  dispatch_failed: 'The write could not be sent to storage.',
  provider_write_rejected: 'Storage refused the write.',
  provider_write_uncertain: 'Storage did not confirm the write; it is being checked.',
  configuration: 'The bucket configuration changed under the write.',
};

function ReceiptChip({ status }: { status: WriteReceipt['status'] }) {
  if (status === 'completed')
    return <StatusChip tone="good" icon={CheckCircle} label="Completed" />;
  if (status === 'failed')
    return <StatusChip tone="critical" icon={WarningTriangle} label="Failed" />;
  return <StatusChip tone="warning" icon={RefreshDouble} spin label="Pending" />;
}

function ReceiptRow({ receipt }: { receipt: WriteReceipt }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
      <ReceiptChip status={receipt.status} />
      <span className="min-w-0 flex-1 break-all font-mono text-xs" title={receipt.key}>
        {receipt.key}
      </span>
      <span className="text-xs text-muted-foreground">{OPERATION[receipt.operation]}</span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {formatUsageBytes(receipt.bytes)}
      </span>
      <Timestamp value={receipt.created_at} className="text-xs text-muted-foreground" />
      <CopyableId value={receipt.id} label="receipt ID" />
      {receipt.error_code && (
        <span className="basis-full text-xs text-muted-foreground">
          {ERROR[receipt.error_code]}
        </span>
      )}
    </li>
  );
}

/**
 * Tracked writes to this bucket: S3 PUTs, copies and upload-route uploads.
 * Completed proves that attempt committed; pending has no outcome yet, and is
 * not a failure (faas pkg/apid/object/write_receipts.go).
 */
export function WriteReceipts({ slug, bucket }: { slug: string; bucket: ObjectBucket }) {
  const [status, setStatus] = useState<ReceiptStatus>('pending');
  const [cursor, setCursor] = useState('');
  const [lookup, setLookup] = useState('');
  const [receiptId, setReceiptId] = useState('');
  const page = useWriteReceipts(slug, bucket.id, status, cursor);
  const items = page.data?.items ?? [];
  const phase = queryPhase({
    loading: page.isPending,
    error: page.error,
    isEmpty: items.length === 0,
  });
  const one = useWriteReceipt(slug, bucket.id, receiptId);
  const onePhase = queryPhase({ loading: one.isPending, error: one.error });
  const find = (event: FormEvent) => {
    event.preventDefault();
    setReceiptId(lookup.trim());
  };

  return (
    <section aria-label={`Tracked writes to ${bucket.name}`} className="flex flex-col gap-4">
      <p className="max-w-prose text-sm text-muted-foreground">
        Writes through the S3 endpoint and upload routes each get a receipt. Completed means that
        write committed; pending means storage has not confirmed it yet, which is not a failure.
      </p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SegmentedControl
          label="Receipt status"
          value={status}
          options={STATUSES}
          onChange={(next) => {
            setStatus(next);
            setCursor('');
          }}
        />
        <form onSubmit={find} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Receipt ID
            <input
              className={cn(FIELD, 'w-72 max-w-full font-mono')}
              value={lookup}
              placeholder="X-Gregale-Upload-ID"
              spellCheck={false}
              onChange={(e) => setLookup(e.target.value)}
            />
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={!lookup.trim()}>
            Look up
          </Button>
        </form>
      </div>
      {receiptId && (
        <div className="rounded-xl border border-border">
          {onePhase !== 'ready' || !one.data ? (
            <div className="px-4 py-3">
              <InlinePhase phase={onePhase} error={one.error} onRetry={() => void one.refetch()} />
            </div>
          ) : (
            <ul aria-label="Receipt found">
              <ReceiptRow receipt={one.data} />
            </ul>
          )}
        </div>
      )}
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={page.error}
          onRetry={() => void page.refetch()}
          loadingMessage="Loading receipts…"
          emptyMessage={
            status === 'pending' ? 'No writes are waiting on storage.' : `No ${status} receipts.`
          }
        />
      ) : (
        <ul
          aria-label={`${STATUSES.find((s) => s.key === status)?.label} receipts`}
          className="flex flex-col divide-y divide-border rounded-xl border border-border"
        >
          {items.map((r) => (
            <ReceiptRow key={r.id} receipt={r} />
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={!cursor} onClick={() => setCursor('')}>
          First page
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!page.data?.next_cursor}
          onClick={() => setCursor(page.data?.next_cursor ?? '')}
        >
          Next page
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void page.refetch()}>
          Refresh
        </Button>
      </div>
    </section>
  );
}
