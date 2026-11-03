import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { NavArrowDown, NavArrowLeft, Sparks } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useCapability, useCapabilityAccess } from '@/lib/api/capabilities';
import { CapabilityNotice } from '../capability-notice';
import { InlinePhase, queryPhase } from '../primitives';
import {
  useCreateEdgeRule,
  useThrottleSuggestions,
  useUpdateEdgeRule,
  type EdgeRule,
} from '@/lib/api/queries';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import type { CapabilityAccess } from '@/lib/capability-state';
import { validateConditions } from '@/lib/edge-rule-match';
import { SegmentedControl } from '../tabs';
import {
  ChipSet,
  Field,
  INPUT,
  KeyValueField,
  NumberField,
  SelectField,
  TextField,
  ToggleRow,
} from './fields';
import { ruleAction } from '@/lib/api/edge-rules';
import { KINDS, type ActionMap, type Kind } from './kinds';
import { OUTCOMES, OUTCOME_GROUPS, SIMPLE_FIELDS, SIMPLE_FORMS } from './creation';
import { explainRule, ruleScope } from './explain';
import { MatchConditionsField, matchOf, matchState, type MatchState } from './match-conditions';
import {
  PENALTY_KINDS,
  PenaltyField,
  samePenalty,
  validatePenalty,
  type Penalty,
} from './penalty-field';

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
 *
 * Everything else an edit sends only when it changed, so a field the person
 * did not touch (a condition written by the CLI, a recipe's name) is never
 * rewritten in the form's shape.
 */

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
const CACHE_METHODS = ['GET', 'HEAD'] as const;

/**
 * The match grammar, as the spec documents it: host is a glob where `*` is
 * any host and `*.example.com` is any subdomain (253 chars, the DNS limit),
 * or `@app` for every host the rule's app serves, custom domains included —
 * what recipes and the docs use for a gate (docs/edge-rules.md §Matching).
 * Path is a Go `path.Match` glob (2048): `/api/*` one or more segments,
 * `/api/**` the prefix and everything beneath, `/users/?*` one segment.
 * OpenAPI templates are refused by apid, which suggests the glob; the form
 * says so first. `match_host` is required on create — it is in the request's
 * `required` list — so creation uses `@app` and `/**`: every path served by
 * the selected app. Custom host and path patterns live in Advanced settings.
 */
const HOST_GLOB =
  /^(@app|\*|(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)$/i;

function validateMatch(m: Match, kind: Kind): Record<string, string> {
  const errors: Record<string, string> = {};
  const host = m.match_host.trim();
  const path = m.match_path.trim();
  if (!host) errors.match_host = 'Required. Use * to match any host.';
  else if (host.length > 253) errors.match_host = 'Hosts are at most 253 characters.';
  else if (!HOST_GLOB.test(host))
    errors.match_host = 'A hostname, @app, or a glob like * or *.example.com.';
  if (!path.startsWith('/')) errors.match_path = 'Paths start with /.';
  else if (path.length > 2048) errors.match_path = 'Paths are at most 2048 characters.';
  else if (/[{}]/.test(path))
    errors.match_path = 'A glob, not a template: /users/?* matches what /users/{id} would.';
  if (
    kind === 'cache' &&
    (!m.match_methods.length ||
      m.match_methods.some((method) => method !== 'GET' && method !== 'HEAD'))
  )
    errors.match_methods = 'Cache rules must match GET, HEAD, or both.';
  return errors;
}

interface Match {
  match_host: string;
  match_path: string;
  match_methods: string[];
  /** Exact-value request-header selectors (at most 10). */
  match_headers: Record<string, string>;
  priority: number;
  enabled: boolean;
}

/** The rule's own fields beside the match: what it is called and whether it acts. */
interface Details {
  name: string;
  description: string;
  /** enforce acts; log is matched and counted but never acts (docs/edge-rules.md §Which rule applies). */
  mode: 'enforce' | 'log';
  /** A `datetime-local` value in the person's time zone; empty for no expiry. */
  expires: string;
  validate_mode: 'block' | 'warn' | 'observe';
}

const pad = (n: number) => String(n).padStart(2, '0');
/** An ISO instant as a datetime-local value in local time. */
function localInput(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function detailsOf(rule: EdgeRule | null): Details {
  return {
    name: rule?.name ?? '',
    description: rule?.description ?? '',
    mode: rule?.mode ?? 'enforce',
    expires: localInput(rule?.expires_at),
    validate_mode: rule?.validate_mode ?? 'block',
  };
}

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface EdgeRuleDialogProps {
  open: boolean;
  onClose: () => void;
  /** Editing when set; creating when null. */
  rule: EdgeRule | null;
  /** The app a new rule is created on. Ignored when editing. */
  slug: string;
  /** `preview_of_slug` marks a preview app, the only kind that takes respond rules. */
  apps: { slug: string; preview_of_slug?: string }[];
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
  const contextIdentity = `${account?.id ?? ''}:${slug}:${rule?.id ?? 'new'}`;
  const [openedFor] = useState(contextIdentity);
  const contextCurrent =
    openedFor === contextIdentity && (!rule || rule.account_id === account?.id);
  const cacheCapability = useCapability('declarative-response-caching');
  const canCache =
    contextCurrent &&
    Boolean(account?.id) &&
    cacheCapability.accountId === account?.id &&
    cacheCapability.state === 'available' &&
    account?.plan !== 'free';
  // Challenge rules and penalties are released per account by platform flags
  // (faas platformflags/catalog.go:359-380), which hidden_capabilities lists
  // while off; apid refuses them before release (edgerules/release.go:155).
  const challengeAccess = useCapabilityAccess('edge-browser-challenge').access;
  const penaltyAccess = useCapabilityAccess('edge-penalty-box').access;
  const challengeReleased = contextCurrent && challengeAccess === 'on';
  const penaltyReleased = contextCurrent && penaltyAccess === 'on';
  // The kinds a catalog capability releases per account (faas capgate
  // edge_rule.<kind>, catalog.json): apid answers 403 capability_not_released
  // before then (capability_settings.go:66).
  const kindAccess: Record<string, CapabilityAccess> = {
    'request-retry': useCapabilityAccess('request-retry').access,
    'circuit-breaking': useCapabilityAccess('circuit-breaking').access,
    'async-routes': useCapabilityAccess('async-routes').access,
    'edge-protection': useCapabilityAccess('edge-protection').access,
  };
  // Warn and block WAF rules, and AI crawler conditions, are released by
  // platform flags; unreleased, the gateway only observes or never matches
  // (edgerules/release.go:16-20).
  const wafBlockingAccess = useCapabilityAccess('edge-waf-blocking').access;
  const aiCrawlerAccess = useCapabilityAccess('edge-ai-crawler-controls').access;
  const create = useCreateEdgeRule();
  const update = useUpdateEdgeRule();
  const editing = rule !== null;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [search, setSearch] = useState('');
  const advancedId = useId();
  const formHeading = useRef<HTMLHeadingElement>(null);
  const formContent = useRef<HTMLDivElement>(null);
  const [formNotice, setFormNotice] = useState('');
  const unfinishedJson = () => {
    const invalid = formContent.current?.querySelector<HTMLTextAreaElement>(
      '[data-invalid-json="true"]'
    );
    if (!invalid) {
      setFormNotice('');
      return false;
    }
    setFormNotice('Correct the JSON before continuing. Your text has been kept.');
    invalid.focus();
    return true;
  };
  const [penalty, setPenalty] = useState<Penalty | null>(rule?.penalty ?? null);

  const [kind, setKind] = useState<Kind | null>(null);
  const [match, setMatch] = useState<Match>({
    match_host: '@app',
    match_path: '/**',
    match_methods: [],
    match_headers: {},
    priority: nextPriority,
    enabled: true,
  });
  const [conditions, setConditions] = useState<MatchState>(() => matchState(rule?.match));
  const [details, setDetails] = useState<Details>(() => detailsOf(rule));
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
        match_headers: rule.match_headers ?? {},
        priority: rule.priority,
        enabled: rule.enabled,
      });
      setAction(ruleAction(rule) as ActionMap[Kind]);
    } else {
      setKind(null);
      setMatch({
        match_host: '@app',
        match_path: '/**',
        match_methods: [],
        match_headers: {},
        priority: nextPriority,
        enabled: true,
      });
      setAction(null);
    }
    setConditions(matchState(rule?.match));
    setDetails(detailsOf(rule));
    setFieldErrors({});
    setProblem(null);
    setSuggestOpen(false);
  }

  useEffect(() => {
    if (kind && !editing) formHeading.current?.focus();
  }, [kind, editing]);

  const def = kind ? KINDS[kind] : null;
  const SimpleForm = kind ? SIMPLE_FORMS[kind] : null;
  const plan = account?.plan ?? 'free';
  const target = apps.find((a) => a.slug === slug);
  /** Why the picker cannot offer a kind, or null when it can. */
  const refusal = (k: Kind): string | null => {
    const d: { paid?: boolean; plans?: readonly string[]; capability?: string } = KINDS[k];
    if (k === 'cache') return canCache ? null : 'Requires confirmed response-cache availability.';
    if (k === 'challenge' && !challengeReleased) return 'Not released to this account yet.';
    const access = d.capability ? kindAccess[d.capability] : 'on';
    if (access === 'off' || (d.capability && !contextCurrent))
      return 'Not released to this account yet.';
    if (access === 'loading') return 'Checking availability…';
    if (access === 'registry-error') return 'Availability could not be checked.';
    if (access === 'runtime-unavailable') return 'Unavailable on this installation.';
    if (access === 'plan-not-entitled') return 'Not included in your plan.';
    if (d.plans && !d.plans.includes(plan)) return 'Needs the Pro plan or above.';
    if (d.paid && plan === 'free') return 'Not on the free plan.';
    if (k === 'respond' && !target?.preview_of_slug)
      return 'Preview apps only; this app is not a preview.';
    return null;
  };
  const showPenalty =
    kind !== null && PENALTY_KINDS.has(kind) && (penaltyReleased || Boolean(rule?.penalty));

  const pick = (next: Kind) => {
    setKind(next);
    setFormNotice('');
    setAdvancedOpen(false);
    setAction(KINDS[next].empty() as ActionMap[Kind]);
    if (next === 'cache') setMatch((current) => ({ ...current, match_methods: ['GET', 'HEAD'] }));
    setFieldErrors({});
    setProblem(null);
  };

  const submit = () => {
    if (!kind || !def || !action) return;
    if (!contextCurrent || unfinishedJson()) return;
    if (kind === 'cache' && !canCache) return;
    // The match block and then the kind's own rules; the server is the
    // backstop, not the plan.
    const expr = matchOf(conditions);
    const expiresAt = details.expires ? new Date(details.expires) : null;
    const local = {
      ...validateMatch(match, kind),
      ...(conditions.mode === 'builder'
        ? validateConditions(conditions.conditions)
        : expr === null
          ? { match: 'Fix the JSON first.' }
          : {}),
      ...(Object.keys(match.match_headers).length > 10
        ? { match_headers: 'At most 10 header selectors.' }
        : {}),
      ...(details.name.length > 100 ? { name: 'At most 100 characters.' } : {}),
      ...(details.description.length > 1000 ? { description: 'At most 1000 characters.' } : {}),
      ...(expiresAt &&
      (Number.isNaN(expiresAt.getTime()) ||
        (details.expires !== detailsOf(rule).expires && expiresAt.getTime() <= Date.now()))
        ? { expires: 'Pick a time in the future.' }
        : {}),
      ...def.validate(action as never),
      ...(!editing &&
      kind === 'headers' &&
      !(action as ActionMap['headers']).request_headers?.length &&
      !(action as ActionMap['headers']).response_headers?.length
        ? { request_headers: 'Add at least one header change.' }
        : {}),
      ...(showPenalty ? validatePenalty(penalty) : {}),
    };
    if (Object.keys(local).length) {
      setFieldErrors(local);
      if (Object.keys(local).some((key) => !SIMPLE_FIELDS[kind]?.includes(key)))
        setAdvancedOpen(true);
      return;
    }
    setFieldErrors({});
    setProblem(null);

    const seeded = detailsOf(rule);
    const expires_at = expiresAt ? expiresAt.toISOString() : undefined;
    // Create sends what is set; an edit sends what changed, with the API's
    // clear_* flags for a condition or expiry that was removed.
    const extras = editing
      ? {
          ...(sameJson(expr, rule?.match) ? {} : expr ? { match: expr } : { clear_match: true }),
          ...(sameJson(match.match_headers, rule?.match_headers ?? {})
            ? {}
            : { match_headers: match.match_headers }),
          ...(details.name !== seeded.name ? { name: details.name.trim() } : {}),
          ...(details.description !== seeded.description
            ? { description: details.description.trim() }
            : {}),
          ...(details.mode !== seeded.mode ? { mode: details.mode } : {}),
          ...(details.expires === seeded.expires
            ? {}
            : expires_at
              ? { expires_at }
              : { clear_expires_at: true }),
        }
      : {
          ...(expr ? { match: expr } : {}),
          ...(Object.keys(match.match_headers).length
            ? { match_headers: match.match_headers }
            : {}),
          ...(details.name.trim() ? { name: details.name.trim() } : {}),
          ...(details.description.trim() ? { description: details.description.trim() } : {}),
          mode: details.mode,
          ...(expires_at ? { expires_at } : {}),
        };

    const body = {
      match_host: match.match_host.trim(),
      match_path: match.match_path.trim(),
      match_methods: match.match_methods,
      priority: match.priority,
      enabled: match.enabled,
      // The top-level field is validate's source of truth (spec
      // CreateEdgeRuleRequest.validate_mode); other kinds carry the default.
      validate_mode: kind === 'validate' ? details.validate_mode : (rule?.validate_mode ?? 'block'),
      ...extras,
      action,
      // Sent only when it changed: clear_penalty removes one and releases the
      // clients it holds (faas pkg/api/dto.go:10729-10734).
      ...(!showPenalty || samePenalty(penalty, rule?.penalty)
        ? {}
        : penalty
          ? { penalty }
          : { clear_penalty: true }),
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
        if (err.fields.length || err.code === 'edge_rule_conflict') setAdvancedOpen(true);
        // 400/422 name the field that was wrong; put the message on it.
        const mapped: Record<string, string> = {};
        for (const f of err.fields) mapped[f.field.replace(/^action\./, '')] = f.expected;
        if (Object.keys(mapped).length) setFieldErrors(mapped);
        return;
      }
      toast({ kind: 'error', title: 'Could not save the rule', error: err });
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
  const preview: EdgeRule | null =
    kind && action
      ? {
          id: rule?.id ?? 'draft',
          account_id: account?.id ?? '',
          app_id: rule?.app_id ?? '',
          created_at: rule?.created_at ?? '',
          updated_at: rule?.updated_at ?? '',
          ...match,
          kind,
          action,
          mode: details.mode,
          validate_mode: details.validate_mode,
          match: matchOf(conditions) ?? undefined,
          ...(details.expires && !Number.isNaN(Date.parse(details.expires))
            ? { expires_at: new Date(details.expires).toISOString() }
            : {}),
        }
      : null;
  const previewReady =
    preview &&
    def &&
    action &&
    !formNotice &&
    !Object.keys({ ...def.validate(action as never), ...validateMatch(match, kind!) }).length &&
    (conditions.mode === 'builder'
      ? !Object.keys(validateConditions(conditions.conditions)).length
      : matchOf(conditions) !== null);
  const visibleGroups = OUTCOME_GROUPS.map((group) => ({
    ...group,
    kinds: group.kinds.filter((key) =>
      `${OUTCOMES[key].title} ${OUTCOMES[key].hint} ${KINDS[key].label} ${key}`
        .toLowerCase()
        .includes(search.trim().toLowerCase())
    ),
  })).filter((group) => group.kinds.length);
  const actionFormProps = {
    value: action as never,
    onChange: (next: unknown) => setAction(next as ActionMap[Kind]),
    errors: fieldErrors,
    apps,
    slug,
    wafBlocking: contextCurrent && wafBlockingAccess === 'on',
    suggest:
      kind === 'throttle' ? (
        <ThrottleSuggest
          slug={slug}
          open={suggestOpen}
          onOpen={() => setSuggestOpen(true)}
          onPick={(rps, burst) =>
            setAction(
              (current) => ({ ...current, requests_per_second: rps, burst }) as ActionMap[Kind]
            )
          }
        />
      ) : undefined,
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit rule' : 'Add a rule'}
      description={
        editing
          ? 'Rules are evaluated in priority order, lowest first.'
          : kind
            ? `Set what happens to requests for ${slug}.`
            : `What should happen to requests for ${slug}?`
      }
      placement="right"
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
                Change action
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submit}
              disabled={pending || !contextCurrent || (kind === 'cache' && !canCache)}
            >
              {pending ? 'Saving…' : editing ? 'Save changes' : 'Create rule'}
            </Button>
          </>
        ) : undefined
      }
    >
      {/* Step one, create only: which kind. Kind cannot change afterwards. */}
      {!kind ? (
        <div className="flex flex-col gap-6">
          <TextField
            label="Find an action"
            mono={false}
            value={search}
            onChange={setSearch}
            placeholder="Try countries, redirects, or rate limits…"
          />
          {visibleGroups.map((group) => (
            <section key={group.title} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-muted-foreground">{group.title}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.kinds.map((k) => {
                  const reason = refusal(k);
                  const stage = (KINDS[k] as { stage?: string }).stage;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => !reason && pick(k)}
                      aria-disabled={Boolean(reason)}
                      className={cn(
                        'flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        reason
                          ? 'cursor-not-allowed border-border bg-card opacity-60'
                          : 'border-border bg-card hover:border-brand/50 hover:bg-muted/40'
                      )}
                    >
                      <span className="text-sm font-medium">{OUTCOMES[k].title}</span>
                      <span className="text-xs leading-relaxed text-muted-foreground">
                        {OUTCOMES[k].hint}
                      </span>
                      {(reason || stage) && (
                        <span className="text-xs text-muted-foreground">{reason ?? stage}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          {!visibleGroups.length && (
            <p role="status" className="text-sm text-muted-foreground">
              No actions match “{search}”. Try a different word.
            </p>
          )}
          {(account?.plan ?? 'free') === 'free' && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              JWT and IP rules need a paid plan.{' '}
              <Link to="/dashboard/plans" className="text-brand hover:underline">
                Compare plans
              </Link>
            </p>
          )}
          {!canCache && (
            <div className="sm:col-span-2">
              <CapabilityNotice
                capability={cacheCapability.capability}
                state={cacheCapability.state}
                onRetry={cacheCapability.refresh}
              />
            </div>
          )}
        </div>
      ) : (
        <div ref={formContent} className="flex flex-col gap-5">
          {formNotice && (
            <p role="alert" className="text-sm text-status-critical">
              {formNotice}
            </p>
          )}
          {!contextCurrent && (
            <p role="status" className="text-xs text-muted-foreground">
              Account or app selection changed. Close and reopen this rule before saving.
            </p>
          )}
          {kind === 'cache' && contextCurrent && !canCache && (
            <CapabilityNotice
              capability={cacheCapability.capability}
              state={cacheCapability.state}
              onRetry={cacheCapability.refresh}
            />
          )}
          {editing && (
            <p className="text-xs text-muted-foreground">
              Kind is <span className="font-mono text-foreground">{kind}</span> and cannot be
              changed.
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
          {problem && problem.status !== 402 && problem.code !== 'edge_rule_conflict' && (
            <p role="alert" className="text-xs text-[color:var(--status-critical)]">
              {errorMessage(problem)}
            </p>
          )}

          {!editing && (
            <>
              <h3
                ref={formHeading}
                tabIndex={-1}
                className="text-lg font-semibold tracking-tight outline-none"
              >
                {OUTCOMES[kind].title}
              </h3>
              {!advancedOpen && SimpleForm && action && (
                <div className="flex flex-col gap-5">
                  <SimpleForm {...actionFormProps} />
                  <SelectField
                    label="When this rule is created"
                    value={!match.enabled ? 'paused' : details.mode}
                    onChange={(value) => {
                      setMatch({ ...match, enabled: value !== 'paused' });
                      setDetails({ ...details, mode: value === 'log' ? 'log' : 'enforce' });
                    }}
                    options={[
                      { value: 'enforce', label: 'Start applying it immediately' },
                      { value: 'log', label: 'Only record matches for now' },
                      { value: 'paused', label: 'Save it paused' },
                    ]}
                  />
                </div>
              )}
              <div
                className="rounded-lg border border-border bg-card p-4"
                role="region"
                aria-label="Rule preview"
                aria-live="polite"
              >
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  If you create this rule
                </p>
                <p className="text-sm font-medium leading-relaxed [overflow-wrap:anywhere]">
                  {previewReady
                    ? explainRule(preview, slug, { wafBlocking: wafBlockingAccess === 'on' })
                    : 'Complete the settings to see what this rule will do.'}
                </p>
                {preview && (
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                    {ruleScope(preview, slug) || `Applies to matching requests for ${slug}.`}
                  </p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Runs at priority {match.priority}, after rules with a lower number. Other rules
                  can affect the final response.
                </p>
              </div>
              <button
                type="button"
                aria-expanded={advancedOpen}
                aria-controls={advancedId}
                onClick={() => {
                  if (!advancedOpen || !unfinishedJson()) setAdvancedOpen(!advancedOpen);
                }}
                className="flex w-full items-center justify-between gap-3 border-t border-border pt-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span>
                  <span className="text-sm font-medium">Advanced settings</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Paths, domains, conditions, and all action options.
                  </span>
                </span>
                <NavArrowDown
                  aria-hidden
                  className={cn(
                    'size-4 shrink-0 transition-transform motion-reduce:transition-none',
                    advancedOpen && 'rotate-180'
                  )}
                />
              </button>
            </>
          )}
          {(editing || advancedOpen) && (
            <div id={advancedId} className="flex flex-col gap-5">
              <section className="flex flex-col gap-4">
                <p className="label-mono text-muted-foreground">Rule</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="Name"
                    hint="Optional. Shown in events and stats."
                    error={fieldErrors.name}
                    mono={false}
                    value={details.name}
                    onChange={(name) => setDetails({ ...details, name })}
                    placeholder="Block scraper"
                  />
                  <Field
                    label="Expires"
                    hint="Optional, your local time. The gateway stops applying the rule then."
                    error={fieldErrors.expires ?? fieldErrors.expires_at}
                  >
                    <input
                      type="datetime-local"
                      value={details.expires}
                      onChange={(e) => setDetails({ ...details, expires: e.target.value })}
                      aria-invalid={fieldErrors.expires ? true : undefined}
                      className={cn(INPUT, 'font-mono')}
                    />
                  </Field>
                </div>
                <TextField
                  label="Description"
                  hint="Optional notes for whoever reads the rule next."
                  error={fieldErrors.description}
                  mono={false}
                  value={details.description}
                  onChange={(description) => setDetails({ ...details, description })}
                />
                <div className="flex flex-col gap-1.5">
                  <span className="label-mono text-muted-foreground">Mode</span>
                  <SegmentedControl
                    label="Rule mode"
                    value={details.mode}
                    options={[
                      { key: 'enforce', label: 'Enforce' },
                      { key: 'log', label: 'Log only' },
                    ]}
                    onChange={(mode) => setDetails({ ...details, mode })}
                  />
                  <span className="text-xs text-muted-foreground">
                    {details.mode === 'log'
                      ? 'Matched and counted, never acts. Check its stats and events, then enforce it.'
                      : 'Acts on every request it matches.'}
                  </span>
                </div>
              </section>

              <section className="flex flex-col gap-4 border-t border-border pt-5">
                <p className="label-mono text-muted-foreground">Match</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="Host"
                    hint="@app for every host the app serves, a hostname, or a glob: * for any, *.example.com for subdomains."
                    error={fieldErrors.match_host}
                    value={match.match_host}
                    onChange={(match_host) => setMatch({ ...match, match_host })}
                    placeholder="api.example.com"
                  />
                  <TextField
                    label="Path"
                    hint="A glob: /api/** is /api and everything beneath it, /api/* the paths beneath, /users/?* one segment."
                    error={fieldErrors.match_path}
                    value={match.match_path}
                    onChange={(match_path) => setMatch({ ...match, match_path })}
                    placeholder="/v1/*"
                  />
                </div>
                <ChipSet
                  label="Methods"
                  hint={
                    kind === 'cache'
                      ? 'Cache rules match GET, HEAD, or both.'
                      : 'None selected matches every method.'
                  }
                  error={fieldErrors.match_methods}
                  options={kind === 'cache' ? CACHE_METHODS : METHODS}
                  value={match.match_methods as (typeof METHODS)[number][]}
                  onChange={(match_methods) => setMatch({ ...match, match_methods })}
                />
                <KeyValueField
                  label="Header selectors"
                  hint="Optional, up to 10. Each header must be present with exactly this value; names ignore case."
                  error={fieldErrors.match_headers}
                  value={match.match_headers}
                  onChange={(match_headers) => setMatch({ ...match, match_headers })}
                  keyPlaceholder="x-tenant"
                  valuePlaceholder="acme"
                />
                <MatchConditionsField
                  value={conditions}
                  onChange={setConditions}
                  errors={fieldErrors}
                  aiCrawlers={aiCrawlerAccess === 'on'}
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
                {kind === 'validate' && (
                  <div className="flex flex-col gap-1.5">
                    <span className="label-mono text-muted-foreground">On a failure</span>
                    <SegmentedControl
                      label="Validation mode"
                      value={details.validate_mode}
                      options={[
                        { key: 'block', label: 'Block' },
                        { key: 'warn', label: 'Warn' },
                        { key: 'observe', label: 'Observe' },
                      ]}
                      onChange={(validate_mode) => setDetails({ ...details, validate_mode })}
                    />
                    <span className="text-xs text-muted-foreground">
                      {details.validate_mode === 'block'
                        ? 'Answers 422 request_validation_failed, with each error.'
                        : details.validate_mode === 'warn'
                          ? 'Lets the request through and adds X-Validation-Warning to the response.'
                          : 'Lets the request through and counts the failure.'}
                    </span>
                  </div>
                )}
                {def && action && (
                  // The registry keeps kind and action in step; this cast is the
                  // one place the pairing is asserted rather than inferred.
                  <def.Form {...actionFormProps} />
                )}
                {showPenalty && (
                  <div className="border-t border-border">
                    <PenaltyField value={penalty} onChange={setPenalty} errors={fieldErrors} />
                  </div>
                )}
              </section>
            </div>
          )}
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
          Per-route metrics are off for this app. Turn them on in its Configuration tab.
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
