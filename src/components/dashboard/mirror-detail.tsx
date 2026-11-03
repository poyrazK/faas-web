import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, FieldError, Textarea } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  REPLAY_MAX_REQUESTS,
  hasUnsafe,
  parseReplayCorpus,
  useMirrorRule,
  useReplayMirror,
  type ReplayResult,
} from '@/lib/api/mirror-replay';
import { useUpdateMirrorRule, type MirrorRule } from '@/lib/api/queries';
import { cn } from '@/lib/utils';
import { InlinePhase, queryPhase } from './primitives';

const short = (id: string) => id.slice(0, 8);

const EXAMPLE = `[
  {"method": "GET", "path": "/orders?limit=5", "expected_status": 200},
  {"method": "GET", "path": "/orders/42", "headers": {"Accept": "application/json"}}
]`;

/**
 * One mirror rule as apid stores it (GET /v1/apps/{slug}/mirrors/{id}): its
 * settings, edited in place, the headers the gateway strips whatever the rule
 * says, and a replay of sanitized historical requests against the mirror.
 */
export function MirrorRuleDetail({ slug, id }: { slug: string; id: string }) {
  const read = useMirrorRule(slug, id);
  const phase = queryPhase({ error: read.error, loading: read.isPending });
  if (phase !== 'ready' || !read.data)
    return (
      <InlinePhase
        phase={phase}
        error={read.error}
        loadingMessage="Reading the rule…"
        onRetry={() => void read.refetch()}
      />
    );
  const rule = read.data;
  return (
    <section
      aria-label="Mirror rule detail"
      className="flex flex-col gap-4 border-t border-border pt-4"
    >
      <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="label-mono text-muted-foreground">Always stripped</dt>
          <dd className="font-mono">{rule.always_stripped_headers.join(', ')}</dd>
        </div>
        <div>
          <dt className="label-mono text-muted-foreground">Methods mirrored</dt>
          <dd>
            {rule.allow_unsafe_methods
              ? 'All, including POST, PUT, PATCH and DELETE'
              : 'GET, HEAD and OPTIONS only'}
          </dd>
        </div>
        <div>
          <dt className="label-mono text-muted-foreground">Created</dt>
          <dd>
            <Timestamp value={rule.created_at} mode="absolute" />
          </dd>
        </div>
        <div>
          <dt className="label-mono text-muted-foreground">Changed</dt>
          <dd>
            <Timestamp value={rule.updated_at} />
          </dd>
        </div>
      </dl>
      <MirrorSettings slug={slug} rule={rule} />
      <MirrorReplay slug={slug} rule={rule} />
    </section>
  );
}

function MirrorSettings({ slug, rule }: { slug: string; rule: MirrorRule }) {
  const update = useUpdateMirrorRule(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [percent, setPercent] = useState(String(rule.percent));
  const [includeBody, setIncludeBody] = useState(rule.include_body);
  const [unsafe, setUnsafe] = useState(rule.allow_unsafe_methods);
  const [redact, setRedact] = useState(rule.redact_headers.join(', '));
  const percentOk = /^\d+$/.test(percent.trim()) && Number(percent) <= 100;
  const headers = redact
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const changes = {
    ...(Number(percent) !== rule.percent ? { percent: Number(percent) } : {}),
    ...(includeBody !== rule.include_body ? { include_body: includeBody } : {}),
    ...(unsafe !== rule.allow_unsafe_methods ? { allow_unsafe_methods: unsafe } : {}),
    ...(headers.join(',') !== rule.redact_headers.join(',') ? { redact_headers: headers } : {}),
  };
  const dirty = Object.keys(changes).length > 0;

  const save = async () => {
    if (!dirty || !percentOk) return;
    // Mirroring writes to a second deployment duplicates side effects; ask first.
    if (changes.allow_unsafe_methods) {
      const ok = await confirm({
        title: 'Mirror POST, PUT, PATCH and DELETE too?',
        description: `${rule.percent === 0 && changes.percent === undefined ? 'Once the share is above 0%, ' : ''}a copy of each mirrored write is sent to deployment ${short(rule.mirror_deployment_id)} as well. Anything it does with them happens for real: rows written, emails sent, payments taken. Responses to callers still come only from the source.`,
        confirmLabel: 'Mirror writes',
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      await update.mutateAsync({ id: rule.id, ...changes });
      toast({ kind: 'success', title: 'Mirror rule updated' });
    } catch (err) {
      toast({
        kind: 'error',
        title:
          err instanceof ApiError && err.code === 'invalid_mirror_percent'
            ? 'Percent must be between 0 and 100'
            : 'Could not update the rule',
        error: err,
      });
    }
  };

  return (
    <form
      noValidate
      aria-label="Mirror settings"
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="flex w-24 flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Share %</span>
        <input
          type="number"
          min={0}
          max={100}
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
          aria-invalid={!percentOk || undefined}
          className={cn(FIELD, 'w-full')}
        />
      </label>
      <label className="flex min-w-48 flex-1 flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Also redact (comma-separated)</span>
        <input
          value={redact}
          onChange={(e) => setRedact(e.target.value)}
          className={cn(FIELD, 'w-full font-mono')}
        />
      </label>
      <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
        <Switch
          checked={includeBody}
          onCheckedChange={setIncludeBody}
          aria-label="Compare response bodies"
          className="data-[state=checked]:bg-brand"
        />
        Compare bodies
      </label>
      <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
        <Switch
          checked={unsafe}
          onCheckedChange={setUnsafe}
          aria-label="Mirror writes"
          className="data-[state=checked]:bg-brand"
        />
        Mirror writes
      </label>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={!dirty || !percentOk}
        busy={update.isPending}
      >
        Save settings
      </Button>
      {!percentOk && (
        <FieldError id={`mirror-${rule.id}-percent`}>A whole number between 0 and 100.</FieldError>
      )}
    </form>
  );
}

function replayFailure(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'debug_replay_unsupported')
      return 'Enable the mirror rule before replaying a corpus.';
    if (err.code === 'plan_mirror_not_allowed') return 'Mirror replay needs the Pro or Scale plan.';
  }
  return errorMessage(err);
}

function MirrorReplay({ slug, rule }: { slug: string; rule: MirrorRule }) {
  const replay = useReplayMirror(slug);
  const confirm = useConfirm();
  const [corpus, setCorpus] = useState('');
  const [ackUnsafe, setAckUnsafe] = useState(false);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [failure, setFailure] = useState('');
  const [tried, setTried] = useState(false);
  const parsed = corpus.trim()
    ? parseReplayCorpus(corpus)
    : { error: 'Paste the requests to replay.' };
  const items = 'items' in parsed ? parsed.items : [];
  const unsafe = hasUnsafe(items);
  const problem =
    'error' in parsed
      ? parsed.error
      : unsafe && !ackUnsafe
        ? 'Acknowledge that writes will reach the mirror.'
        : undefined;

  const send = async () => {
    setTried(true);
    if (problem || replay.isPending) return;
    const ok = await confirm({
      title: `Replay ${items.length} request${items.length === 1 ? '' : 's'} against ${short(rule.mirror_deployment_id)}?`,
      description: `They are queued against the mirror deployment only, with credential, platform and redacted headers stripped again; nothing reaches the source or a caller.${unsafe ? ' The batch includes writes, which the mirror carries out for real.' : ''} Results join this rule's drift counts.`,
      confirmLabel: 'Replay',
      destructive: unsafe,
    });
    if (!ok) return;
    setFailure('');
    try {
      setResult(
        await replay.mutateAsync({ id: rule.id, requests: items, allowUnsafe: unsafe && ackUnsafe })
      );
    } catch (err) {
      setFailure(replayFailure(err));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="label-mono text-muted-foreground">Replay a corpus</p>
      <p className="text-xs text-muted-foreground">
        Up to {REPLAY_MAX_REQUESTS} sanitized requests from your own logs, as JSON. Bodies stay
        under 64 KiB; source response bodies are never uploaded, only an optional expected SHA-256.
        {!rule.enabled && ' The rule is disabled: enable it to replay.'}
      </p>
      <Textarea
        aria-label="Requests to replay"
        rows={5}
        value={corpus}
        onChange={(e) => setCorpus(e.target.value)}
        placeholder={EXAMPLE}
        spellCheck={false}
        className="font-mono text-xs"
        aria-invalid={Boolean(tried && problem) || undefined}
      />
      {unsafe && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={ackUnsafe}
            onChange={(e) => setAckUnsafe(e.target.checked)}
          />
          The batch includes POST, PUT, PATCH or DELETE; send them to the mirror anyway.
        </label>
      )}
      {tried && problem && <FieldError id={`mirror-${rule.id}-replay-error`}>{problem}</FieldError>}
      {failure && (
        <p role="alert" className="text-xs text-[color:var(--status-critical)]">
          {failure}
        </p>
      )}
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={!rule.enabled}
          busy={replay.isPending}
          onClick={() => void send()}
        >
          Replay
        </Button>
      </div>
      {result && (
        <div role="status" className="flex flex-col gap-1 text-xs">
          <p>{result.queued} queued against the mirror.</p>
          <ul className="flex flex-col gap-0.5 font-mono">
            {result.invocations.map((inv) => (
              <li key={inv.mirror_invocation_id} className="flex flex-wrap gap-x-2">
                <span className="text-muted-foreground">{inv.request_id}</span>
                <a
                  className="text-brand underline-offset-4 hover:underline"
                  href={`/dashboard/invocations?invocation=${encodeURIComponent(inv.mirror_invocation_id)}`}
                >
                  {short(inv.mirror_invocation_id)}
                </a>
                <span className="text-muted-foreground">{inv.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
