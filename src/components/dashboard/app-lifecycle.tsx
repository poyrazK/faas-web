import { useState } from 'react';
import { Refresh, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { usePurgeAppCache, useRestartApp } from '@/lib/api/queries';
import { cn } from '@/lib/utils';

/**
 * Two operations on a running app that had CLI verbs and no button.
 *
 * Restart parks every instance, snapshots afresh, and queues one replacement
 * wake; the API answers with the `wake_id`, so the toast names it — that is
 * the row to look for in the wake timeline. It is single-flight per app, so a
 * `409` means one is already running, and `402 admission_refused` means the
 * account's spend cap is blocking new wakes, which is a budget decision, not
 * a fault.
 *
 * Cache purge clears the edge response cache, optionally under a path glob.
 * It is a request rather than a guarantee (`204`, "purge requested"), so the
 * confirmation says so instead of claiming the cache is empty.
 */

export function RestartAppButton({ slug }: { slug: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const restart = useRestartApp(slug);

  const onRestart = async () => {
    if (
      !(await confirm({
        title: `Restart ${slug}?`,
        description:
          'Every live instance is parked and one replacement wake is queued from a fresh snapshot. In-flight requests are lost.',
        confirmLabel: 'Restart',
        destructive: true,
      }))
    )
      return;
    try {
      const result = await restart.mutateAsync();
      toast({
        kind: 'success',
        title: 'Restart queued',
        description: `Replacement wake ${result.wake_id.slice(0, 12)} — it appears in the wake timeline.`,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast({
          kind: 'info',
          title: 'Already restarting',
          description: 'One restart runs at a time for an app.',
        });
        return;
      }
      if (err instanceof ApiError && err.code === 'admission_refused') {
        toast({
          kind: 'info',
          title: 'Spend cap reached',
          description: 'New wakes are refused until the overage cap is raised or cleared.',
        });
        return;
      }
      toast({ kind: 'error', title: 'Could not restart', description: errorMessage(err) });
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={() => void onRestart()}
      disabled={restart.isPending}
    >
      <Refresh className="h-3.5 w-3.5" />
      Restart
    </Button>
  );
}

export function PurgeCacheControl({ slug }: { slug: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const purge = usePurgeAppCache(slug);
  const [path, setPath] = useState('');

  const onPurge = async () => {
    const glob = path.trim();
    if (
      !(await confirm({
        title: glob ? `Purge cached responses under ${glob}?` : 'Purge every cached response?',
        description:
          'The next request for each purged path is served by the app rather than the edge.',
        confirmLabel: 'Purge',
      }))
    )
      return;
    try {
      await purge.mutateAsync(glob || undefined);
      toast({
        kind: 'success',
        title: 'Purge requested',
        description: glob
          ? `Every gateway was asked to drop ${glob}.`
          : 'Every gateway was asked to drop this app’s cache.',
      });
      setPath('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        toast({
          kind: 'error',
          title: 'That path glob was rejected',
          description: errorMessage(err),
        });
        return;
      }
      toast({ kind: 'error', title: 'Could not purge', description: errorMessage(err) });
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="label-mono text-muted-foreground">Response cache</span>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!purge.isPending) void onPurge();
        }}
      >
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/products/*  (empty purges everything)"
          spellCheck={false}
          aria-label="Path glob to purge"
          className={cn(FIELD, 'w-72')}
        />
        <Button type="submit" size="sm" variant="outline" busy={purge.isPending}>
          <Trash className="h-3.5 w-3.5" />
          Purge
        </Button>
      </form>
      <span className="text-xs text-muted-foreground">
        Asks every gateway to drop its in-process cache for this app. Cached responses elsewhere are
        unaffected.
      </span>
    </div>
  );
}
