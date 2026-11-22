import { useRef, useState } from 'react';
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
import { formatRelative, type Deployment, type Workflow } from '@/lib/mock-data';
import { useParkApp, useWakeApp } from '@/lib/api/queries';
import { RESTORE_CONTEXT, RESTORE_TARGET } from '@/lib/platform-claims';
import { useData } from '@/lib/store';
import { useRestartAction } from './app-lifecycle';
import { useShowsProduction } from './production-only-banner';
import { useTearDownPreview } from './preview-actions';

/**
 * Everything the app header can do besides deploy.
 *
 * These were four or five outline buttons in a row, all the same weight as
 * Deploy's neighbours, so the one action people come here for competed with
 * the ones they rarely want. Each item keeps the confirmation it had as a
 * button; destructive ones sit below a separator.
 */
/**
 * Rolling back: `POST /v1/apps/{slug}/rollback` with no body, which brings back
 * the most recent superseded release. `target` names it when the deployments
 * say which one it is.
 */
function useRollbackAction(
  app: Workflow,
  target: Pick<Deployment, 'version' | 'createdAt'> | null
) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { redeploy } = useData();
  const where = target ? `${target.version}, deployed ${formatRelative(target.createdAt)}` : null;
  return async () => {
    if (
      !(await confirm({
        title: `Roll back ${app.name}?`,
        description: `${
          where
            ? `${app.name} goes back to ${where}.`
            : 'The platform brings back the most recent replaced release.'
        } The current release stays in history, so you can roll forward again.`,
        confirmLabel: 'Roll back',
        destructive: true,
      }))
    )
      return;
    // The 202 names the earlier deployment it re-activates (apid
    // rollbackAppCore writes no new row); acceptance does not mean it is
    // serving yet: a readiness check runs first.
    try {
      const deployment = await redeploy(app.id);
      toast({
        kind: 'success',
        title: 'Rollback queued',
        description: `Returning to deployment ${deployment.id.slice(0, 12)}. It serves once its readiness check passes.`,
      });
    } catch (err) {
      toast({ kind: 'error', title: 'Rollback failed', error: err });
    }
  };
}

/**
 * Roll back, in the header beside Deploy: the way out of a bad release
 * should be one click away, not inside a menu. It names where it goes.
 */
export function RollbackButton({
  app,
  target,
  isDeploying,
}: {
  app: Workflow;
  target: Pick<Deployment, 'version' | 'createdAt'> | null;
  isDeploying: boolean;
}) {
  const rollback = useRollbackAction(app, target);
  const [pending, setPending] = useState(false);
  // Outside production the top bar names another environment, but rollback
  // acts on the app's production lane: say so on the button.
  const showsProduction = useShowsProduction();
  return (
    <Button
      size="sm"
      variant="outline"
      className="gap-1.5"
      disabled={isDeploying || pending}
      title={
        isDeploying
          ? 'Wait for the current deploy to finish'
          : target
            ? `Go back to ${target.version}, deployed ${formatRelative(target.createdAt)}`
            : 'Go back to the previous release'
      }
      onClick={() => {
        setPending(true);
        void rollback().finally(() => setPending(false));
      }}
    >
      <Undo aria-hidden className="h-4 w-4" />
      {showsProduction ? 'Roll back production' : 'Roll back'}
    </Button>
  );
}

/** The header's Deploy label: it deploys production, which outside production it names. */
export function DeployLabel({ deploying }: { deploying: boolean }) {
  const showsProduction = useShowsProduction();
  return <>{deploying ? 'Deploying…' : showsProduction ? 'Deploy to production' : 'Deploy'}</>;
}

export function AppActionsMenu({ app }: { app: Workflow }) {
  const { toast } = useToast();
  const confirm = useConfirm();
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
