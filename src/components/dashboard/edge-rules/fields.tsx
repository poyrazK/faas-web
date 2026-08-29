import { useState, type ReactNode } from 'react';
import { Plus, Xmark } from 'iconoir-react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/**
 * The controls the thirteen edge-rule forms are built from.
 *
 * Each takes a value and an onChange and nothing else about the rule it
 * belongs to, so the same chip list serves CORS origins, JWT audiences, and
 * geo country codes, and a field error from the server lands on whichever
 * of them the server named.
 */

export const INPUT =
  'h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand/50 aria-invalid:border-[color:var(--status-critical)]';

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="label-mono text-muted-foreground">{label}</span>
      {children}
      {error ? (
        <span className="text-xs" style={{ color: 'var(--status-critical)' }} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export function TextField({
  label,
  hint,
  error,
  value,
  onChange,
  placeholder,
  mono = true,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        className={cn(INPUT, mono && 'font-mono')}
      />
    </Field>
  );
}

export function NumberField({
  label,
  hint,
  error,
  value,
  onChange,
  min = 0,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      <input
        type="number"
        min={min}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        aria-invalid={error ? true : undefined}
        className={cn(INPUT, 'font-mono [font-variant-numeric:tabular-nums]')}
      />
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  hint,
  error,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        aria-invalid={error ? true : undefined}
        className={INPUT}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 max-w-lg text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        aria-label={label}
        className="mt-0.5 data-[state=checked]:bg-brand"
      />
    </div>
  );
}

/** A fixed vocabulary, any subset: HTTP methods, JWT algorithms. */
export function ChipSet<T extends string>({
  label,
  hint,
  error,
  options,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  error?: string;
  options: readonly T[];
  value: T[];
  onChange: (v: T[]) => void;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {options.map((opt) => {
          const on = value.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== opt) : [...value, opt])}
              className={cn(
                'h-8 rounded-md border px-2.5 font-mono text-xs pressable',
                on
                  ? 'border-brand bg-brand/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

/**
 * Free-form strings, any number: origins, audiences, country codes, content
 * types. Enter or comma adds; paste splits on both; Backspace on an empty
 * input removes the last.
 */
export function StringListField({
  label,
  hint,
  error,
  value,
  onChange,
  placeholder,
  normalize = (s) => s,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  normalize?: (s: string) => string;
}) {
  const [draft, setDraft] = useState('');
  const commit = (raw: string) => {
    const next = raw
      .split(/[,\n]/)
      .map((s) => normalize(s.trim()))
      .filter((s) => s && !value.includes(s));
    if (next.length) onChange([...value, ...next]);
    setDraft('');
  };
  return (
    <Field label={label} hint={hint} error={error}>
      <div
        className={cn(
          'flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 focus-within:border-brand/50',
          error && 'border-[color:var(--status-critical)]'
        )}
      >
        {value.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 font-mono text-xs"
          >
            {item}
            <button
              type="button"
              aria-label={`Remove ${item}`}
              onClick={() => onChange(value.filter((x) => x !== item))}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <Xmark className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit(draft);
            } else if (e.key === 'Backspace' && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() && commit(draft)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (/[,\n]/.test(text)) {
              e.preventDefault();
              commit(text);
            }
          }}
          placeholder={value.length ? '' : placeholder}
          spellCheck={false}
          className="min-w-28 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground"
        />
      </div>
    </Field>
  );
}

/** One-per-line, for CIDRs and anything else a person pastes from a config. */
export function LinesField({
  label,
  hint,
  error,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  rows?: number;
}) {
  // Kept as text while editing so a half-typed line is not split or dropped.
  const [text, setText] = useState(value.join('\n'));
  return (
    <Field label={label} hint={hint} error={error}>
      <textarea
        value={text}
        rows={rows}
        spellCheck={false}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setText(e.target.value);
          onChange(
            e.target.value
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)
          );
        }}
        className={cn(INPUT, 'h-auto resize-y py-2 font-mono leading-relaxed')}
      />
    </Field>
  );
}

/** name → value pairs: redirect headers, required JWT claims. */
export function KeyValueField({
  label,
  hint,
  error,
  value,
  onChange,
  keyPlaceholder = 'name',
  valuePlaceholder = 'value',
}: {
  label: string;
  hint?: string;
  error?: string;
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const entries = Object.entries(value);
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  const add = () => {
    const key = k.trim();
    if (!key) return;
    onChange({ ...value, [key]: v });
    setK('');
    setV('');
  };
  return (
    <Field label={label} hint={hint} error={error}>
      <div className="flex flex-col gap-1.5">
        {entries.map(([key, val]) => (
          <div key={key} className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded border border-border bg-card px-2 py-1.5 font-mono text-xs">
              {key}
            </code>
            <code className="min-w-0 flex-1 truncate rounded border border-border bg-card px-2 py-1.5 font-mono text-xs text-muted-foreground">
              {val || '—'}
            </code>
            <button
              type="button"
              aria-label={`Remove ${key}`}
              onClick={() => {
                const next = { ...value };
                delete next[key];
                onChange(next);
              }}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <Xmark className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <input
            value={k}
            onChange={(e) => setK(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
            placeholder={keyPlaceholder}
            spellCheck={false}
            className={cn(INPUT, 'h-8 flex-1 font-mono text-xs')}
          />
          <input
            value={v}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
            placeholder={valuePlaceholder}
            spellCheck={false}
            className={cn(INPUT, 'h-8 flex-1 font-mono text-xs')}
          />
          <button
            type="button"
            aria-label="Add pair"
            onClick={add}
            disabled={!k.trim()}
            className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </Field>
  );
}

export interface HeaderOp {
  name: string;
  value?: string;
  action: 'add' | 'set' | 'remove';
}

/** Ordered header operations; `remove` has no value, and the field says so. */
export function HeaderOpsField({
  label,
  hint,
  error,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: HeaderOp[];
  onChange: (v: HeaderOp[]) => void;
}) {
  const update = (i: number, patch: Partial<HeaderOp>) =>
    onChange(value.map((op, j) => (j === i ? { ...op, ...patch } : op)));
  return (
    <Field label={label} hint={hint} error={error}>
      <div className="flex flex-col gap-1.5">
        {value.map((op, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={op.action}
              onChange={(e) =>
                update(i, {
                  action: e.target.value as HeaderOp['action'],
                  value: e.target.value === 'remove' ? undefined : (op.value ?? ''),
                })
              }
              aria-label="Operation"
              className={cn(INPUT, 'h-8 w-24 text-xs')}
            >
              <option value="set">set</option>
              <option value="add">add</option>
              <option value="remove">remove</option>
            </select>
            <input
              value={op.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="X-Header-Name"
              spellCheck={false}
              aria-label="Header name"
              className={cn(INPUT, 'h-8 flex-1 font-mono text-xs')}
            />
            <input
              value={op.action === 'remove' ? '' : (op.value ?? '')}
              disabled={op.action === 'remove'}
              onChange={(e) => update(i, { value: e.target.value })}
              placeholder={op.action === 'remove' ? '—' : 'value'}
              spellCheck={false}
              aria-label="Header value"
              className={cn(INPUT, 'h-8 flex-1 font-mono text-xs disabled:opacity-40')}
            />
            <button
              type="button"
              aria-label="Remove operation"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <Xmark className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...value, { name: '', value: '', action: 'set' }])}
          className="inline-flex w-fit items-center gap-1 text-xs text-brand transition-colors hover:text-brand-hover"
        >
          <Plus className="h-3 w-3" />
          Add operation
        </button>
      </div>
    </Field>
  );
}

/**
 * JSON that has to parse before it can be submitted. Parses on blur and pins
 * the error where JSON.parse says it is; the form refuses to send text the
 * server would only 422.
 */
export function JsonField({
  label,
  hint,
  error,
  value,
  onChange,
  rows = 8,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown> | null) => void;
  rows?: number;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const parse = (raw: string) => {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setParseError('The schema has to be a JSON object.');
        onChange(null);
        return;
      }
      setParseError(null);
      onChange(parsed as Record<string, unknown>);
    } catch (e) {
      setParseError(e instanceof Error ? e.message.replace(/^JSON\.parse: /, '') : 'Invalid JSON');
      onChange(null);
    }
  };
  return (
    <Field label={label} hint={hint} error={parseError ?? error}>
      <div className="relative">
        <textarea
          value={text}
          rows={rows}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => parse(e.target.value)}
          aria-invalid={parseError || error ? true : undefined}
          className={cn(INPUT, 'h-auto resize-y py-2 font-mono text-xs leading-relaxed')}
        />
        <button
          type="button"
          onClick={() => {
            try {
              const pretty = JSON.stringify(JSON.parse(text), null, 2);
              setText(pretty);
              parse(pretty);
            } catch {
              parse(text);
            }
          }}
          className="absolute right-2 top-2 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Format
        </button>
      </div>
    </Field>
  );
}
