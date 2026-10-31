import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import {
  APP_DELETE_GRACE_DAYS,
  restoreErrorMessage,
  useDeletedApps,
  useRestoreDeletedApp,
  type DeletedApp,
} from '@/lib/api/deleted-apps';
import { useAuth } from '@/lib/auth';
import { formatRelative } from '@/lib/mock-data';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const absolute = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Time left in the restore window, measured from the server's `evaluated_at`
 * rather than the browser clock, which the API says not to trust for this.
 * Rounded down, so the console never promises more time than there is.
 */
function timeLeft(row: DeletedApp): string {
  const ms = Date.parse(row.delete_grace_until ?? '') - Date.parse(row.evaluated_at);
  if (!Number.isFinite(ms) || ms <= 0) return 'window closing';
  if (ms >= 2 * DAY) return `${Math.floor(ms / DAY)} days left`;
  const hours = Math.floor(ms / HOUR);
  if (hours >= 1) return `${hours} ${hours === 1 ? 'hour' : 'hours'} left`;
  return 'less than an hour left';
}

const BLOCKED: Record<Exclude<DeletedApp['restore_blocker'], ''>, string> = {
  grace_expired: 'The restore window has closed. It will be removed for good shortly.',
  purge_started: 'Permanent removal has started. It can no longer be restored.',
  metadata_unavailable: 'Its deletion time was not recorded, so it cannot be restored.',
};

function Stamp({ at }: { at: string | null }) {
  if (!at) return <>an unknown time</>;
  const ms = Date.parse(at);
  return (
    <time dateTime={at} title={absolute.format(ms)}>
      {formatRelative(ms)}
    </time>
  );
}

function Row({
  row,
  onRestore,
  busy,
}: {
  row: DeletedApp;
  onRestore: (row: DeletedApp) => void;
  busy: boolean;
}) {
  const soon =
    row.restore_eligible &&
    Date.parse(row.delete_grace_until ?? '') - Date.parse(row.evaluated_at) < DAY;
  return (
    <li className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate font-mono text-sm">{row.slug}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Deleted <Stamp at={row.deleted_at} />
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:justify-end">
        {row.restore_eligible && row.delete_grace_until ? (
          <p className="text-xs text-muted-foreground">
            Restorable until{' '}
            <time dateTime={row.delete_grace_until} className="text-foreground">
              {absolute.format(Date.parse(row.delete_grace_until))}
            </time>{' '}
            ·{' '}
            <span style={soon ? { color: 'var(--status-warning)' } : undefined}>
              {timeLeft(row)}
            </span>
          </p>
        ) : (
          <p className="max-w-xs text-xs text-muted-foreground">
            {BLOCKED[row.restore_blocker as keyof typeof BLOCKED] ??
              'It can no longer be restored.'}
          </p>
        )}
        {row.restore_eligible && (
          <Button
            size="sm"
            variant="outline"
            busy={busy}
            aria-label={`Restore ${row.slug}`}
            onClick={() => onRestore(row)}
          >
            Restore
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * The Apps page's "Recently deleted" section: the account's retained deleted
 * apps (`GET /v1/deleted-apps`) and an exact-ID restore for each one still in
 * its window. Restoring by ID rather than slug means a reused name can never
 * redirect the restore to a different app.
 */
export function RecentlyDeletedApps() {
  const { account } = useAuth();
  const accountId = account?.id ?? '';
  const inventory = useDeletedApps(accountId);
  const restore = useRestoreDeletedApp();
  const confirm = useConfirm();
  const { toast } = useToast();
  const navigate = useNavigate();

  if (!accountId) return null;

  const rows = inventory.data?.pages.flatMap((page) => page.apps) ?? [];
  const phase = queryPhase({
    error: inventory.error,
    loading: inventory.isPending,
    isEmpty: rows.length === 0,
  });

  const onRestore = async (row: DeletedApp) => {
    if (
      !(await confirm({
        title: `Restore ${row.slug}?`,
        description:
          'It comes back with the same ID, settings and deployment history. Check its status afterwards: a restored app may need a deploy or a wake before it serves traffic.',
        confirmLabel: 'Restore app',
      }))
    )
      return;
    try {
      const restored = await restore.mutateAsync(row.id);
      toast({
        kind: 'success',
        title: `Restored ${restored.slug}`,
        description: 'Its settings and history are back. Check its status before sending traffic.',
      });
      void navigate({ to: '/dashboard/apps/$appSlug', params: { appSlug: restored.slug } });
    } catch (err) {
      toast({
        kind: 'error',
        title: `Could not restore ${row.slug}`,
        description: restoreErrorMessage(err, row.slug),
      });
    }
  };

  return (
    <Panel
      title="Recently deleted"
      description={`Deleted apps can be restored for ${APP_DELETE_GRACE_DAYS} days. After that they are removed for good.`}
      padded={false}
    >
      {phase === 'ready' ? (
        <>
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                onRestore={(r) => void onRestore(r)}
                busy={restore.isPending && restore.variables === row.id}
              />
            ))}
          </ul>
          {inventory.hasNextPage && (
            <div className="border-t border-border px-5 py-3">
              <Button
                size="sm"
                variant="ghost"
                busy={inventory.isFetchingNextPage}
                onClick={() => void inventory.fetchNextPage()}
              >
                Show more
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="px-5 py-4">
          <InlinePhase
            phase={phase}
            error={inventory.error}
            loadingMessage="Loading recently deleted apps…"
            emptyMessage={`No apps deleted in the last ${APP_DELETE_GRACE_DAYS} days.`}
            onRetry={() => void inventory.refetch()}
          />
        </div>
      )}
    </Panel>
  );
}
