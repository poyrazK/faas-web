import { Plus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useEdgeRuleLists } from '@/lib/api/edge-rules';
import { useAuth } from '@/lib/auth';
import {
  AI_CRAWLER_FIELDS,
  CLOSED_VALUES,
  MATCH_FIELDS,
  NAMED_FIELDS,
  OP_LABEL,
  conditionsFrom,
  conditionsToMatch,
  emptyCondition,
  listKindFor,
  opsFor,
  valueShape,
  type Condition,
  type Conditions,
  type MatchExpr,
  type MatchField,
} from '@/lib/edge-rule-match';
import { cn } from '@/lib/utils';
import { SegmentedControl } from '../tabs';
import { INPUT, JsonField } from './fields';

/**
 * The rule's `match` condition: a builder over one join of leaves, or the raw
 * expression as JSON when the tree is deeper than the builder draws (see
 * `lib/edge-rule-match.ts`). `json` is null while its text does not parse.
 */
export type MatchState =
  { mode: 'builder'; conditions: Conditions } | { mode: 'json'; expr: MatchExpr | null };

export function matchState(match: MatchExpr | null | undefined): MatchState {
  const conditions = conditionsFrom(match);
  return conditions ? { mode: 'builder', conditions } : { mode: 'json', expr: match ?? {} };
}

/** The expression to send; undefined for none; null when the JSON does not parse. */
export function matchOf(state: MatchState): MatchExpr | null | undefined {
  if (state.mode === 'builder') return conditionsToMatch(state.conditions);
  if (!state.expr) return null;
  return Object.keys(state.expr).length ? state.expr : undefined;
}

export function MatchConditionsField({
  value,
  onChange,
  errors,
  aiCrawlers,
}: {
  value: MatchState;
  onChange: (next: MatchState) => void;
  errors: Record<string, string>;
  /** AI crawler fields are offered only while released (edge-ai-crawler-controls). */
  aiCrawlers: boolean;
}) {
  const toBuilder = value.mode === 'json' && value.expr ? conditionsFrom(value.expr) : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="label-mono text-muted-foreground">Conditions</p>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
            Optional. Checked as well as the host, path and methods: country, client IP, ASN,
            headers, cookies, query parameters, crawlers, or an account list.
          </p>
        </div>
        {value.mode === 'builder' ? (
          <button
            type="button"
            onClick={() =>
              onChange({ mode: 'json', expr: conditionsToMatch(value.conditions) ?? {} })
            }
            className="text-xs text-brand transition-colors hover:text-brand-hover"
          >
            Edit as JSON
          </button>
        ) : toBuilder ? (
          <button
            type="button"
            onClick={() => onChange({ mode: 'builder', conditions: toBuilder })}
            className="text-xs text-brand transition-colors hover:text-brand-hover"
          >
            Use the builder
          </button>
        ) : null}
      </div>

      {value.mode === 'json' ? (
        <JsonField
          label="Condition (JSON)"
          hint={
            toBuilder
              ? 'A tree of all, any and not over {"field", "op", "value" | "values" | "list"} leaves. {} is no condition.'
              : 'This condition nests groups, which only JSON can show. At most 4 levels and 32 parts.'
          }
          error={errors.match}
          value={value.expr ?? {}}
          objectMessage="A condition is a JSON object."
          onChange={(expr) => onChange({ mode: 'json', expr })}
        />
      ) : (
        <Builder
          conditions={value.conditions}
          onChange={(conditions) => onChange({ mode: 'builder', conditions })}
          errors={errors}
          aiCrawlers={aiCrawlers}
        />
      )}
    </div>
  );
}

function Builder({
  conditions,
  onChange,
  errors,
  aiCrawlers,
}: {
  conditions: Conditions;
  onChange: (next: Conditions) => void;
  errors: Record<string, string>;
  aiCrawlers: boolean;
}) {
  const set = (i: number, patch: Partial<Condition>) =>
    onChange({
      ...conditions,
      items: conditions.items.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    });
  return (
    <>
      {conditions.items.length > 1 && (
        <SegmentedControl
          label="Conditions join"
          value={conditions.join}
          options={[
            { key: 'all', label: 'All of these' },
            { key: 'any', label: 'Any of these' },
          ]}
          onChange={(join) => onChange({ ...conditions, join })}
        />
      )}
      {errors.match && (
        <span className="text-xs" style={{ color: 'var(--status-critical)' }} role="alert">
          {errors.match}
        </span>
      )}
      {conditions.items.map((c, i) => (
        <ConditionRow
          key={i}
          index={i}
          condition={c}
          error={errors[`match.${i}`]}
          aiCrawlers={aiCrawlers}
          onChange={(patch) => set(i, patch)}
          onRemove={() =>
            onChange({ ...conditions, items: conditions.items.filter((_, j) => j !== i) })
          }
        />
      ))}
      <div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() =>
            onChange({ ...conditions, items: [...conditions.items, emptyCondition()] })
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Add condition
        </Button>
      </div>
    </>
  );
}

function ConditionRow({
  index,
  condition: c,
  error,
  aiCrawlers,
  onChange,
  onRemove,
}: {
  index: number;
  condition: Condition;
  error?: string;
  aiCrawlers: boolean;
  onChange: (patch: Partial<Condition>) => void;
  onRemove: () => void;
}) {
  const n = index + 1;
  const shape = valueShape(c.op);
  const fields = MATCH_FIELDS.filter(
    (f) => aiCrawlers || !AI_CRAWLER_FIELDS.has(f.value) || f.value === c.field
  );
  const ops = opsFor(c.field);
  const pickField = (field: MatchField) => {
    const allowed = opsFor(field);
    onChange({
      field,
      name: NAMED_FIELDS.has(field) ? c.name : '',
      op: allowed.includes(c.op) ? c.op : allowed[0],
      list: '',
    });
  };
  return (
    <div className="flex flex-col gap-2 well rounded-xl bg-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={c.negate}
          aria-label={`Condition ${n} negated`}
          onClick={() => onChange({ negate: !c.negate })}
          className={cn(
            'h-9 rounded-md border px-2.5 font-mono text-xs pressable',
            c.negate
              ? 'border-brand bg-brand/10 text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground'
          )}
        >
          not
        </button>
        <select
          aria-label={`Condition ${n} field`}
          value={c.field}
          onChange={(e) => pickField(e.target.value as MatchField)}
          className={cn(INPUT, 'w-auto min-w-0 flex-1 sm:flex-none')}
        >
          {fields.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        {NAMED_FIELDS.has(c.field) && (
          <input
            aria-label={`Condition ${n} name`}
            value={c.name}
            placeholder={c.field === 'header' ? 'x-beta' : c.field === 'cookie' ? 'session' : 'q'}
            onChange={(e) => onChange({ name: e.target.value })}
            className={cn(INPUT, 'w-auto min-w-0 flex-1 font-mono sm:w-36 sm:flex-none')}
          />
        )}
        <select
          aria-label={`Condition ${n} operator`}
          value={c.op}
          onChange={(e) => onChange({ op: e.target.value as Condition['op'] })}
          className={cn(INPUT, 'w-auto min-w-0 flex-1 sm:flex-none')}
        >
          {ops.map((op) => (
            <option key={op} value={op}>
              {OP_LABEL[op]}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label={`Remove condition ${n}`}
          onClick={onRemove}
          className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
        >
          <Trash className="h-3.5 w-3.5" />
        </button>
      </div>
      {shape === 'one' && (
        <input
          aria-label={`Condition ${n} value`}
          aria-invalid={error ? true : undefined}
          value={c.values[0] ?? ''}
          placeholder={c.op === 'regex' ? '^/api/v[0-9]+/' : 'value'}
          onChange={(e) => onChange({ values: [e.target.value] })}
          className={cn(INPUT, 'font-mono')}
        />
      )}
      {shape === 'many' && (
        <input
          aria-label={`Condition ${n} values`}
          aria-invalid={error ? true : undefined}
          value={c.values.join(',')}
          placeholder={
            c.op === 'cidr' ? '10.0.0.0/8, 2001:db8::/32' : 'one, or several separated by commas'
          }
          onChange={(e) => onChange({ values: e.target.value.split(',') })}
          className={cn(INPUT, 'font-mono')}
        />
      )}
      {shape === 'list' && (
        <ListSelect
          label={`Condition ${n} list`}
          kind={listKindFor(c.field)}
          value={c.list}
          onChange={(list) => onChange({ list })}
        />
      )}
      {error ? (
        <span className="text-xs" style={{ color: 'var(--status-critical)' }} role="alert">
          {error}
        </span>
      ) : CLOSED_VALUES[c.field] && shape !== 'none' ? (
        <span className="text-xs text-muted-foreground">Values: {CLOSED_VALUES[c.field]}.</span>
      ) : c.field === 'asn' && shape !== 'none' ? (
        <span className="text-xs text-muted-foreground">13335 or AS13335.</span>
      ) : null}
    </div>
  );
}

/** The account's lists whose kind fits the field (edge_rule_list.go:228). */
function ListSelect({
  label,
  kind,
  value,
  onChange,
}: {
  label: string;
  kind: string | null;
  value: string;
  onChange: (name: string) => void;
}) {
  const { account } = useAuth();
  const lists = useEdgeRuleLists(account?.id ?? '', true);
  const fitting = (lists.data?.lists ?? []).filter((l) => l.kind === kind);
  const known = !value || fitting.some((l) => l.name === value);
  return (
    <div className="flex flex-col gap-1">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
      >
        <option value="">Pick a list…</option>
        {fitting.map((l) => (
          <option key={l.id} value={l.name}>
            {l.name} ({l.item_count})
          </option>
        ))}
        {!known && <option value={value}>{value}</option>}
      </select>
      {lists.error ? (
        <span className="text-xs text-muted-foreground">
          The account’s lists could not be read.
        </span>
      ) : !lists.isPending && !fitting.length ? (
        <span className="text-xs text-muted-foreground">
          No {kind} list yet. Create one under Rule lists on this page.
        </span>
      ) : null}
    </div>
  );
}
