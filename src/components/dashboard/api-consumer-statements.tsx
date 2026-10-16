import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api/errors';
import {
  useConsumerStatements,
  useFinalizeStatement,
  useSnapshotStatement,
  useStatementHandoff,
  type ConsumerStatement,
} from '@/lib/api/monetization';
import { InlinePhase, queryPhase } from './primitives';
import { Pill, ResourceTable, type Column } from './resource-table';
import {
  Facts,
  STATUS_COLOR,
  explainWrite,
  formatCount,
  formatMillicents,
  formatPeriod,
  formatUtc,
  monthWindow,
  previousMonthValue,
} from './monetization-shared';

/**
 * A consumer's usage statements: immutable quote snapshots, newest period
 * first. Snapshotting an unchanged period replays the existing revision, a
 * changed draft is superseded by a new one, and usage that arrives after
 * finalization becomes the next (adjustment) revision. Finalizing is the one
 * irreversible step, so it is confirmed and offered only for a fully priced
 * draft — the API rejects the rest with `conflict` anyway.
 */

type Row = {
  id: string;
  period: string;
  revision: number;
  status: ConsumerStatement['status'];
  billable_units: number;
  amount: string;
  created_at: string;
  statement: ConsumerStatement;
};

export function finalizeCopy(revision: number) {
  return {
    title: `Finalize revision ${revision}?`,
    description:
      'Finalized statements are immutable: this revision can never be edited, re-priced or deleted. Usage that arrives later is billed as a new adjustment revision. A signed usage_statement.finalized webhook is sent if a subscription matches.',
    confirmLabel: 'Finalize statement',
  };
}

export function ConsumerStatements({ slug, consumerId }: { slug: string; consumerId: string }) {
  const statements = useConsumerStatements(slug, consumerId);
  const snapshot = useSnapshotStatement(slug, consumerId);
  const finalize = useFinalizeStatement(slug, consumerId);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [month, setMonth] = useState(previousMonthValue);
  const [selectedId, setSelectedId] = useState('');
  const period = monthWindow(month);

  const rows: Row[] = (statements.data ?? []).map((s) => ({
    id: s.id,
    period: formatPeriod(s.period_start, s.period_end),
    revision: s.revision,
    status: s.status,
    billable_units: s.billable_units,
    amount: s.priced ? formatMillicents(s.amount_millicents, s.currency) : 'Not fully priced',
    created_at: s.created_at,
    statement: s,
  }));
  const selected = statements.data?.find((s) => s.id === selectedId);

  const onSnapshot = async (e: FormEvent) => {
    e.preventDefault();
    if (!period || snapshot.isPending) return;
    try {
      const result = await snapshot.mutateAsync({
        period_start: period.since,
        period_end: period.until,
      });
      setSelectedId(result.id);
      toast({
        kind: 'success',
        title: `Revision ${result.revision} is ${result.status}`,
        description: 'An unchanged period replays its latest revision instead of adding one.',
      });
    } catch (err) {
      toast(explainWrite(err, 'snapshot the statement'));
    }
  };

  const onFinalize = async (s: ConsumerStatement) => {
    if (!(await confirm({ ...finalizeCopy(s.revision), destructive: true }))) return;
    try {
      await finalize.mutateAsync(s.id);
      toast({ kind: 'success', title: `Revision ${s.revision} finalized` });
    } catch (err) {
      toast(
        explainWrite(
          err,
          'finalize the statement',
          'Could not finalize: only a fully priced draft can be finalized'
        )
      );
    }
  };

  const columns: Column<Row>[] = [
    { key: 'period', label: 'Period' },
    { key: 'revision', label: 'Rev.', numeric: true },
    {
      key: 'status',
      label: 'Status',
      render: (r) => <Pill label={r.status} color={STATUS_COLOR[r.status]} />,
    },
    {
      key: 'billable_units',
      label: 'Units',
      numeric: true,
      render: (r) => formatCount(r.billable_units),
    },
    { key: 'amount', label: 'Amount', numeric: true },
  ];

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => void onSnapshot(e)}>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Period (UTC calendar month)</span>
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="Statement period"
            className="w-auto"
          />
        </label>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!period}
          busy={snapshot.isPending}
        >
          Snapshot statement
        </Button>
      </form>
      <ResourceTable
        rows={rows}
        columns={columns}
        onRowClick={(r) => setSelectedId(r.id)}
        loading={statements.isPending}
        error={statements.error}
        onRetry={() => void statements.refetch()}
        emptyMessage="No statements yet. Snapshot a period to create the first."
        minWidth="min-w-[640px]"
        rowActions={(r) =>
          r.status === 'draft' && r.statement.priced ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => void onFinalize(r.statement)}
              disabled={finalize.isPending}
              aria-label={`Finalize revision ${r.revision}`}
            >
              Finalize
            </Button>
          ) : null
        }
      />
      {selected && <StatementDetail slug={slug} consumerId={consumerId} statement={selected} />}
    </div>
  );
}

function StatementDetail({
  slug,
  consumerId,
  statement,
}: {
  slug: string;
  consumerId: string;
  statement: ConsumerStatement;
}) {
  const finalized = statement.status === 'finalized';
  const handoff = useStatementHandoff(slug, consumerId, statement.id, finalized);
  const notRecorded = handoff.error instanceof ApiError && handoff.error.code === 'not_found';
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <p className="text-sm font-medium">
        Revision {statement.revision} · {formatPeriod(statement.period_start, statement.period_end)}
      </p>
      <Facts
        items={[
          ['Status', statement.status],
          [
            'Amount',
            formatMillicents(statement.amount_millicents, statement.currency) +
              (statement.priced ? '' : ' (not fully priced)'),
          ],
          ['Billable units', formatCount(statement.billable_units)],
          ['Unpriced units', formatCount(statement.unpriced_units)],
          ['Usage minutes captured', formatCount(statement.buckets.length)],
          ['Usage as of', formatUtc(statement.as_of)],
          ['Created', formatUtc(statement.created_at)],
          ['Finalized', formatUtc(statement.finalized_at)],
        ]}
      />
      {!statement.priced && statement.status === 'draft' && (
        <p className="text-xs text-muted-foreground">
          Some units have no effective rate card, so this draft cannot be finalized. Publish a rate
          card covering the period, then snapshot again.
        </p>
      )}
      {finalized && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">Billing handoff</p>
          {notRecorded ? (
            <p className="text-sm text-muted-foreground">
              No handoff recorded. Your billing system records one through the API when it invoices
              this statement.
            </p>
          ) : (
            <>
              <InlinePhase
                phase={queryPhase({ error: handoff.error, loading: handoff.isPending })}
                error={handoff.error}
                loadingMessage="Reading the handoff receipt…"
                onRetry={() => void handoff.refetch()}
              />
              {handoff.data && (
                <Facts
                  items={[
                    ['External invoice', handoff.data.external_invoice_id],
                    [
                      'Amount',
                      formatMillicents(handoff.data.amount_millicents, handoff.data.currency),
                    ],
                    ['Recorded', formatUtc(handoff.data.created_at)],
                  ]}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
