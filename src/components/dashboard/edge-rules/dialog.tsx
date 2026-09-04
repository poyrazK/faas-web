import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { NavArrowLeft, Sparks } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { InlinePhase, queryPhase } from '../primitives';
import {
  useCreateEdgeRule,
  useThrottleSuggestions,
  useUpdateEdgeRule,
  type EdgeRule,
} from '@/lib/api/queries';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { ChipSet, NumberField, TextField, ToggleRow } from './fields';
import { KINDS, KIND_ORDER, type ActionMap, type Kind } from './kinds';

/**
 * Create or edit one edge rule.
 *
 * The match block lives here; the action is delegated to the kind's own form
 * in `kinds.tsx`. Two rules the API imposes shape this:
 *
 * - **Kind is immutable on update.** The spec is explicit that rotating it
 *   would break the action union, so edit mode shows the kind as a label and
 *   says to delete and recreate.
 * - **`action` replaces whole.** There is no partial-update shape for it, so
 *   the draft always carries a complete action.
 */

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

/**
 * The match grammar, as the spec documents it: host is a glob where `*` is
 * any host and `*.example.com` is any subdomain (253 chars, the DNS limit);
 * path is a glob whose trailing `*` matches everything beneath (2048).
 * `match_host` is required on create — it is in the request's `required` list
 * — so the form defaults it to `*` rather than letting empty mean anything.
 */
const HOST_GLOB = /^(\*|(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)$/i;

function validateMatch(m: Match): Record<string, string> {
  const errors: Record<string, string> = {};
  const host = m.match_host.trim();
  const path = m.match_path.trim();
  if (!host) errors.match_host = 'Required. Use * to match any host.';
  else if (host.length > 253) errors.match_host = 'Hosts are at most 253 characters.';
  else if (!HOST_GLOB.test(host))
    errors.match_host = 'A hostname, or a glob like * or *.example.com.';
  if (!path.startsWith('/')) errors.match_path = 'Paths start with /.';
  else if (path.length > 2048) errors.match_path = 'Paths are at most 2048 characters.';
  else if (path.includes('*') && !path.endsWith('*'))
    errors.match_path = 'Only a trailing * is allowed — it matches everything beneath.';
  return errors;
}

interface Match {
  match_host: string;
  match_path: string;
  match_methods: string[];
  priority: number;
  enabled: boolean;
}

export interface EdgeRuleDialogProps {
  open: boolean;
  onClose: () => void;
  /** Editing when set; creating when null. */
  rule: EdgeRule | null;
  /** The app a new rule is created on. Ignored when editing. */
  slug: string;
  apps: { slug: string }[];
  /** Suggested next priority for a new rule. */
  nextPriority: number;
}

export function EdgeRuleDialog({
  open,
  onClose,
  rule,
  slug,
  apps,
  nextPriority,
}: EdgeRuleDialogProps) {
  const { toast } = useToast();
  const { account } = useAuth();
  const create = useCreateEdgeRule();
  const update = useUpdateEdgeRule();
  const editing = rule !== null;

  const [kind, setKind] = useState<Kind | null>(null);
  const [match, setMatch] = useState<Match>({
    match_host: '*',
    match_path: '/*',
    match_methods: [],
    priority: nextPriority,
    enabled: true,
  });
  const [action, setAction] = useState<ActionMap[Kind] | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<ApiError | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);

  // Re-seed whenever the dialog opens onto a different rule. Keyed rather than
  // effect-driven: the caller remounts by changing `key`, so this runs once.
  const seed = rule?.id ?? 'new';
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (seededFor !== seed) {
    setSeededFor(seed);
    if (rule) {
      setKind(rule.kind as Kind);
      setMatch({
        match_host: rule.match_host,
        match_path: rule.match_path,
        match_methods: rule.match_methods ?? [],
        priority: rule.priority,
        enabled: rule.enabled,
      });
      setAction(rule.action as ActionMap[Kind]);
    } else {
      setKind(null);
      setMatch({
        match_host: '*',
        match_path: '/*',
        match_methods: [],
        priority: nextPriority,
        enabled: true,
      });
      setAction(null);
    }
    setFieldErrors({});
    setProblem(null);
    setSuggestOpen(false);
  }

  const def = kind ? KINDS[kind] : null;
  const planAllows = (k: Kind) => !KINDS[k].paid || (account?.plan ?? 'free') !== 'free';

  const pick = (next: Kind) => {
    setKind(next);
    setAction(KINDS[next].empty() as ActionMap[Kind]);
    setFieldErrors({});
    setProblem(null);
  };

  const submit = () => {
    if (!kind || !def || !action) return;
    // The match block and then the kind's own rules; the server is the
    // backstop, not the plan.
    const local = { ...validateMatch(match), ...def.validate(action as never) };
    if (Object.keys(local).length) {
      setFieldErrors(local);
      return;
    }
    setFieldErrors({});
    setProblem(null);

    const body = {
      match_host: match.match_host.trim(),
      match_path: match.match_path.trim(),
      match_methods: match.match_methods,
      priority: match.priority,
      enabled: match.enabled,
      validate_mode: rule?.validate_mode ?? 'block',
      action,
    };

    const done = (verb: string) => {
      toast({
        kind: 'success',
        title: `Rule ${verb}`,
        description: `${def.label} on ${match.match_host}`,
      });
      onClose();
    };
    const failed = (err: unknown) => {
      if (err instanceof ApiError) {
        setProblem(err);
        // 400/422 name the field that was wrong; put the message on it.
        const mapped: Record<string, string> = {};
        for (const f of err.fields) mapped[f.field.replace(/^action\./, '')] = f.expected;
        if (Object.keys(mapped).length) setFieldErrors(mapped);
        return;
      }
      toast({ kind: 'error', title: 'Could not save the rule', description: errorMessage(err) });
    };

    if (editing && rule) {
      // `kind` is deliberately not sent — the API refuses to rotate it.
      void update
        .mutateAsync({ id: rule.id, ...body })
        .then(() => done('updated'))
        .catch(failed);
    } else {
      void create
        .mutateAsync({ slug, kind, ...body })
        .then(() => done('created'))
        .catch(failed);
    }
  };

  const pending = create.isPending || update.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit rule` : kind ? KINDS[kind].label : 'Add an edge rule'}
      description={
        editing
          ? 'Rules are evaluated in priority order, lowest first.'
          : kind
            ? KINDS[kind].desc
            : 'Rules run at the gateway, before a request reaches an app.'
      }
      width="max-w-3xl"
      footer={
        kind ? (
          <>
            {!editing && (
              <Button
                variant="ghost"
                size="sm"
                className="mr-auto gap-1.5"
                onClick={() => setKind(null)}
              >
                <NavArrowLeft className="h-3.5 w-3.5" />
                Kind
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={pending}>
              {pending ? 'Saving…' : editing ? 'Save changes' : 'Create rule'}
            </Button>
          </>
        ) : undefined
      }
    >
      {/* Step one, create only: which kind. Kind cannot change afterwards. */}
      {!kind ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {KIND_ORDER.map((k) => {
            const allowed = planAllows(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => allowed && pick(k)}
                aria-disabled={!allowed}
                className={cn(
                  'flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors',
                  allowed
                    ? 'border-border bg-card hover:border-brand/50'
                    : 'cursor-not-allowed border-border bg-card opacity-60'
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {KINDS[k].label}
                  {KINDS[k].paid && (
                    <span className="label-mono rounded-full border border-border px-1.5 text-muted-foreground">
                      paid
                    </span>
                  )}
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {allowed ? KINDS[k].desc : 'Not on the free plan.'}
                </span>
              </button>
            );
          })}
          {(account?.plan ?? 'free') === 'free' && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              JWT and IP rules need a paid plan.{' '}
              <Link to="/dashboard/plans" className="text-brand hover:underline">
                Compare plans
              </Link>
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {editing && (
            <p className="text-xs text-muted-foreground">
              Kind is <span className="font-mono text-foreground">{kind}</span> and cannot be
              changed — delete the rule and create a new one to switch.
            </p>
          )}

          {/* A 402 is the plan refusing, not the input being wrong. */}
          {problem?.status === 402 && (
            <div
              className="rounded-md border px-3 py-2 text-xs"
              style={{ borderColor: 'color-mix(in oklab, var(--status-warning) 40%, transparent)' }}
            >
              {problem.message}{' '}
              <Link to="/dashboard/plans" className="text-brand hover:underline">
                Compare plans
              </Link>
            </div>
          )}
          {problem?.code === 'edge_rule_conflict' && (
            <div
              role="alert"
              className="rounded-md border px-3 py-2 text-xs"
              style={{
                borderColor: 'color-mix(in oklab, var(--status-critical) 40%, transparent)',
              }}
            >
              {problem.message} Try a different priority or a narrower path.
            </div>
          )}

          <section className="flex flex-col gap-4">
            <p className="label-mono text-muted-foreground">Match</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Host"
                hint="A hostname, or a glob: * for any, *.example.com for subdomains."
                error={fieldErrors.match_host}
                value={match.match_host}
                onChange={(match_host) => setMatch({ ...match, match_host })}
                placeholder="api.example.com"
              />
              <TextField
                label="Path"
                hint="A path. A trailing * matches everything beneath it."
                error={fieldErrors.match_path}
                value={match.match_path}
                onChange={(match_path) => setMatch({ ...match, match_path })}
                placeholder="/v1/*"
              />
            </div>
            <ChipSet
              label="Methods"
              hint="None selected matches every method."
              options={METHODS}
              value={match.match_methods as (typeof METHODS)[number][]}
              onChange={(match_methods) => setMatch({ ...match, match_methods })}
            />
            <NumberField
              label="Priority"
              hint="Lowest first. Leave gaps so a rule can be slotted between later."
              error={fieldErrors.priority}
              value={match.priority}
              min={0}
              onChange={(priority) => setMatch({ ...match, priority: priority ?? 0 })}
              className="sm:w-56"
            />
            <div className="border-t border-border">
              <ToggleRow
                label="Enabled"
                hint="A disabled rule stays configured and is skipped at the gateway."
                checked={match.enabled}
                onChange={(enabled) => setMatch({ ...match, enabled })}
              />
            </div>
          </section>

          <section className="flex flex-col gap-4 border-t border-border pt-5">
            <p className="label-mono text-muted-foreground">{def?.label}</p>
            {def && action && (
              // The registry keeps kind and action in step; this cast is the
              // one place the pairing is asserted rather than inferred.
              <def.Form
                value={action as never}
                onChange={(next: unknown) => setAction(next as ActionMap[Kind])}
                errors={fieldErrors}
                apps={apps}
                slug={editing ? (apps.find((a) => a.slug === slug)?.slug ?? slug) : slug}
                suggest={
                  kind === 'throttle' ? (
                    <ThrottleSuggest
                      slug={slug}
                      open={suggestOpen}
                      onOpen={() => setSuggestOpen(true)}
                      onPick={(rps, burst) =>
                        setAction({ requests_per_second: rps, burst } as ActionMap[Kind])
                      }
                    />
                  ) : undefined
                }
              />
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

/**
 * The recommender, on demand.
 *
 * `GET /v1/apps/{slug}/throttle-suggestions` walks the per-route rate over a
 * window and clamps to the plan ceiling, so anything it offers is settable.
 * Advice only: it fills the fields, it never saves.
 */
function ThrottleSuggest({
  slug,
  open,
  onOpen,
  onPick,
}: {
  slug: string;
  open: boolean;
  onOpen: () => void;
  onPick: (rps: number, burst: number) => void;
}) {
  const q = useThrottleSuggestions(slug, '24h', open);
  const rows = useMemo(() => q.data?.suggestions ?? [], [q.data]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex w-fit items-center gap-1.5 text-xs text-brand transition-colors hover:text-brand-hover"
      >
        <Sparks className="h-3.5 w-3.5" />
        Suggest from the last 24 hours
      </button>
    );
  }

  return (
    <div className="rounded-md border border-border bg-card p-3">
      {q.isPending || q.error ? (
        <div className="text-xs">
          <InlinePhase
            phase={queryPhase({ error: q.error, loading: q.isPending })}
            error={q.error}
            loadingMessage="Reading traffic…"
          />
        </div>
      ) : q.data?.route_metrics_disabled ? (
        <p className="text-xs text-muted-foreground">
          Per-route metrics are off for this app, so there is nothing to measure. Turn them on in
          the app&rsquo;s Configuration tab.
        </p>
      ) : !rows.length ? (
        <p className="text-xs text-muted-foreground">
          No traffic in the window
          {q.data?.source?.startsWith('degraded') ? ' (metrics degraded)' : ''}.
        </p>
      ) : (
        <>
          <p className="label-mono mb-2 text-muted-foreground">
            Observed vs suggested · ceiling {q.data?.plan_ceiling_rps} rps
          </p>
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((r) => (
              <li key={r.route} className="flex items-center gap-3 py-1.5 text-xs">
                <span className="min-w-0 flex-1 truncate font-mono">{r.route}</span>
                <span className="text-muted-foreground [font-variant-numeric:tabular-nums]">
                  {r.observed_rps.toFixed(1)} → {r.suggested_rps}
                </span>
                <button
                  type="button"
                  onClick={() => onPick(r.suggested_rps, r.suggested_burst)}
                  className="text-brand transition-colors hover:text-brand-hover"
                >
                  Use
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
