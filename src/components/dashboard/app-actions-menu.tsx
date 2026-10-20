import { useRef } from 'react';
import { MoreHoriz, Pause, Play, Refresh, Trash, Undo } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import type { Workflow } from '@/lib/mock-data';
import { useParkApp, useWakeApp } from '@/lib/api/queries';
import { RESTORE_CONTEXT, RESTORE_TARGET } from '@/lib/platform-claims';
import { useData } from '@/lib/store';
import { useRestartAction } from './app-lifecycle';
import { useTearDownPreview } from './preview-actions';

/**
 * Everything the app header can do besides deploy.
 *
 * These were four or five outline buttons in a row, all the same weight as
 * Deploy's neighbours, so the one action people come here for competed with
 * the ones they rarely want. Each item keeps the confirmation it had as a
 * button; destructive ones sit below a separator.
 */
export function AppActionsMenu({
  app,
  canRollback,
  isDeploying,
}: {
  app: Workflow;
  canRollback: boolean;
  isDeploying: boolean;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { redeploy } = useData();
  const park = useParkApp();
  const wake = useWakeApp();
  const restart = useRestartAction(app.id);
  const tearDown = useTearDownPreview(app.id);
  // An item's confirmation opens while the menu is closing, so the dialog
  // remembers the vanished item as the place to return focus to and drops it
  // on the page body. Put it back on the trigger once the action settles.
  const trigger = useRef<HTMLButtonElement>(null);
  const run = (action: () => Promise<void>) =>
    void action().finally(() => trigger.current?.focus());

  const onPark = async () => {
    if (
      !(await confirm({
        title: `Park ${app.name}?`,
        description: `Running instances snapshot and release now. The next request pays the wake cost. ${RESTORE_TARGET}. ${RESTORE_CONTEXT}`,
        confirmLabel: 'Park',
      }))
    )
      return;
    try {
      await park.mutateAsync(app.id);
      toast({ kind: 'success', title: `Parked ${app.name}` });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not park', error: err });
    }
  };

  const onWake = async () => {
    try {
      await wake.mutateAsync(app.id);
      toast({ kind: 'success', title: `Waking ${app.name}` });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not wake', error: err });
    }
  };

  const onRollback = async () => {
    if (
      !(await confirm({
        title: `Roll back ${app.name}?`,
        description:
          'Traffic moves to the previous successful deployment. The current one stays available to roll forward to.',
        confirmLabel: 'Roll back',
      }))
    )
      return;
    // `POST /v1/apps/{slug}/rollback` — a real write, so the toast reports
    // what happened rather than announcing it up front.
    try {
      await redeploy(app.id);
      toast({
        kind: 'success',
        title: 'Rolled back',
        description: `${app.name} is serving its previous deployment.`,
      });
    } catch (err) {
      toast({ kind: 'error', title: 'Rollback failed', error: err });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild ref={trigger}>
        <Button variant="outline" size="sm" aria-label="More app actions" className="px-2">
          <MoreHoriz aria-hidden className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Park and wake were two of the unused hooks: the API has had both
            for as long as the console has existed. */}
        {app.state === 'running' && (
          <DropdownMenuItem disabled={park.isPending} onSelect={() => run(onPark)}>
            <Pause aria-hidden className="h-3.5 w-3.5" />
            Park
          </DropdownMenuItem>
        )}
        {app.state === 'idle' && (
          <DropdownMenuItem disabled={wake.isPending} onSelect={() => run(onWake)}>
            <Play aria-hidden className="h-3.5 w-3.5" />
            Wake
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={restart.pending} onSelect={() => run(restart.run)}>
          <Refresh aria-hidden className="h-3.5 w-3.5" />
          Restart
        </DropdownMenuItem>
        {canRollback && (
          <DropdownMenuItem disabled={isDeploying} onSelect={() => run(onRollback)}>
            <Undo aria-hidden className="h-3.5 w-3.5" />
            {isDeploying ? 'Roll back (deploying…)' : 'Roll back'}
          </DropdownMenuItem>
        )}
        {tearDown.available && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={tearDown.pending}
              onSelect={() => run(tearDown.run)}
              className="text-[color:var(--status-critical)] data-[highlighted]:text-[color:var(--status-critical)]"
            >
              <Trash aria-hidden className="h-3.5 w-3.5" />
              Tear down preview
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
