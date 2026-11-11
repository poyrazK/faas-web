import { useId, useState, type ReactNode } from 'react';
import { CopyIconButton } from '@/components/ui/copy-button';
import { cn } from '@/lib/utils';
import { DOMAIN_TONE, recordPurpose, type DomainTone, type RecordRow } from './domain-words';

/**
 * DNS records as a DNS provider's form asks for them: the type, then a name
 * and a value, each copyable on its own. One record per block, so a long
 * token wraps instead of pushing the card wider.
 */
export function DnsRecordList({
  records,
  label,
  purpose = true,
}: {
  records: RecordRow[];
  /** The list's accessible name. */
  label: string;
  /** Say what each record is for. */
  purpose?: boolean;
}) {
  return (
    <ul aria-label={label} className="flex flex-col gap-2">
      {records.map((record) => (
        <li
          key={`${record.type} ${record.name ?? ''} ${record.value}`}
          className="flex flex-col gap-1.5 rounded-lg bg-background/70 px-3 py-2.5"
        >
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              {record.type}
            </span>
            {purpose && <span>{recordPurpose(record)}</span>}
          </span>
          <dl className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1 text-xs">
            {record.name !== null && (
              <Field term="Name" value={record.name} copyLabel={`${record.type} name`} />
            )}
            <Field
              term="Value"
              value={record.value}
              copyLabel={`${record.type} ${record.name === null ? 'record' : 'value'}`}
            />
          </dl>
        </li>
      ))}
    </ul>
  );
}

function Field({ term, value, copyLabel }: { term: string; value: string; copyLabel: string }) {
  return (
    <>
      <dt className="pt-1 text-muted-foreground">{term}</dt>
      <dd className="flex min-w-0 items-start gap-1">
        <code className="min-w-0 flex-1 select-all pt-1 font-mono [overflow-wrap:anywhere]">
          {value}
        </code>
        <CopyIconButton text={value} label={`${copyLabel} ${value}`} />
      </dd>
    </>
  );
}

/** One status word with its dot. */
export function StatusWord({
  word,
  tone,
  title,
  className,
}: {
  word: string;
  tone: DomainTone;
  title?: string;
  className?: string;
}) {
  const colour = DOMAIN_TONE[tone];
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px]',
        className
      )}
      style={{ color: tone === 'muted' ? 'var(--muted-foreground)' : colour }}
    >
      <span
        aria-hidden
        className="size-[7px] rounded-full"
        style={
          tone === 'muted'
            ? { boxShadow: `inset 0 0 0 1.5px ${colour}` }
            : { backgroundColor: colour }
        }
      />
      {word}
    </span>
  );
}

/** "Show details" for technical facts: one click away, never inline by default. */
export function Reveal({
  show = 'Show details',
  hide = 'Hide details',
  children,
}: {
  show?: string;
  hide?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="pressable w-fit rounded text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {open ? hide : show}
      </button>
      {open && <div id={id}>{children}</div>}
    </div>
  );
}
