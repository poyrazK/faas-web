import { useLayoutEffect, useRef, useState } from 'react';
import { Refresh, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { usePurgeAppCache, useRestartApp } from '@/lib/api/queries';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useCapability } from '@/lib/api/capabilities';
import { cachePurgeSelection } from '@/lib/cache-policy';
import { CapabilityNotice } from './capability-notice';
import { PolicyStatus } from './policy-status';
import { usePolicyOperation } from './policy-operation';

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
 * Cache purge requests an all, path, or tag invalidation.
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
      if (err instanceof ApiError && err.code === 'conflict') {
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

export function PurgeCacheControl({ slug, appId = '' }: { slug: string; appId?: string }) {
  const { account } = useAuth();
  const capability = useCapability('declarative-response-caching');
  const { toast } = useToast();
  const confirm = useConfirm();
  const purge = usePurgeAppCache(slug);
  const [mode, setMode] = useState<'all' | 'path' | 'tag'>('all');
  const [input, setInput] = useState('');
  const [problem, setProblem] = useState('');
  const flight = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const operation = usePolicyOperation(account?.id ?? '', slug, appId, 'purge');
  const canPurge =
    Boolean(account?.id && appId && slug) &&
    account?.plan !== 'free' &&
    capability.accountId === account?.id &&
    capability.state === 'available';
  const identity = `${account?.id ?? ''}:${slug}:${appId}`;
  const context = useRef({ identity, canPurge, epoch: 0, selection: `${mode}:${input}` });
  useLayoutEffect(() => {
    const previous = context.current;
    context.current = {
      identity,
      canPurge,
      epoch:
        previous.identity === identity && previous.canPurge === canPurge
          ? previous.epoch
          : previous.epoch + 1,
      selection: `${mode}:${input}`,
    };
  }, [identity, canPurge, mode, input]);

  const onPurge = async () => {
    if (flight.current || operation.busy || !canPurge) return;
    let selection: { path?: string; tag?: string };
    try {
      selection = cachePurgeSelection(mode, input);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Review the purge selection.');
      return;
    }
    setProblem('');
    const started = context.current;
    const current = () =>
      context.current.canPurge &&
      context.current.epoch === started.epoch &&
      context.current.identity === started.identity &&
      context.current.selection === started.selection;
    flight.current = true;
    setConfirming(true);
    try {
      const target = selection.path ?? selection.tag;
      const scope = selection.path ? 'path' : selection.tag ? 'tag' : 'all';
      const approved = await confirm({
        title:
          scope === 'path'
            ? `Purge cached responses under ${target}?`
            : scope === 'tag'
              ? `Purge cached responses tagged ${target}?`
              : 'Purge every cached response?',
        description:
          'Records a purge request. Cached responses may remain until serving gateways and the optional shared tier apply it.',
        confirmLabel: 'Purge',
      });
      if (!approved || !current()) return;
      const accepted = await operation.run(['response_cache'], async () => {
        if (!current()) throw new Error('Cache availability changed. Review this purge again.');
        await purge.mutateAsync(selection);
        return true;
      });
      if (!accepted) return;
      toast({
        kind: 'success',
        title: 'Purge requested',
        description: target
          ? `The ${scope} purge for ${target} is saved. Runtime application is verified separately.`
          : 'The purge is saved. Runtime application is verified separately.',
      });
      setInput('');
    } catch (err) {
      if (!current()) return;
      if (err instanceof ApiError && err.code === 'validation_failed') {
        toast({
          kind: 'error',
          title: 'That purge selection was rejected',
          description: errorMessage(err),
        });
        return;
      }
      toast({
        kind: 'error',
        title: 'Could not confirm the purge',
        description:
          err instanceof ApiError
            ? errorMessage(err)
            : 'The request may have been accepted. Inspect runtime status before sending another purge.',
      });
    } finally {
      flight.current = false;
      setConfirming(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="label-mono text-muted-foreground">Response cache</span>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!purge.isPending && !operation.busy && !confirming) void onPurge();
        }}
      >
        <select
          aria-label="Purge scope"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as 'all' | 'path' | 'tag');
            setInput('');
            setProblem('');
          }}
          className={cn(FIELD, 'w-40')}
        >
          <option value="all">All responses</option>
          <option value="path">Path glob</option>
          <option value="tag">Cache tag</option>
        </select>
        {mode !== 'all' && (
          <input
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setProblem('');
            }}
            placeholder={mode === 'path' ? '/products/*' : 'product:42'}
            spellCheck={false}
            aria-label={mode === 'path' ? 'Path glob to purge' : 'Cache tag to purge'}
            className={cn(FIELD, 'w-72')}
          />
        )}
        <Button
          type="submit"
          size="sm"
          variant="outline"
          busy={purge.isPending || operation.busy || confirming}
          disabled={!canPurge}
        >
          <Trash className="h-3.5 w-3.5" />
          Purge
        </Button>
      </form>
      {problem && (
        <span role="alert" className="text-xs text-[color:var(--status-critical)]">
          {problem}
        </span>
      )}
      {!canPurge && (
        <CapabilityNotice
          capability={capability.capability}
          state={capability.state}
          onRetry={capability.refresh}
        />
      )}
      <span className="text-xs text-muted-foreground">
        Requests a purge of Gregale’s gateway cache and optional shared Redis tier. External caches
        and CDNs are unaffected.
      </span>
      {operation.receipt && appId && (
        <PolicyStatus accountId={account?.id ?? ''} slug={slug} receipt={operation.receipt} />
      )}
    </div>
  );
}
