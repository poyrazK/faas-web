import type { CSSProperties, ReactNode } from 'react';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { useAppDeployments } from '@/lib/api/queries';
import { GATE_MESSAGES } from './capability-gate';
import { deploymentLabel } from './deployment-promote';
import { HelpTip } from './kit/help-tip';
import type { SafetyTone } from './release-safety-words';

export const SAFETY_TONE: Record<SafetyTone, string> = {
  good: 'var(--status-good)',
  active: 'var(--brand)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
  idle: 'var(--muted-foreground)',
};

/** Colour is never the only signal: every dot sits beside its word. Idle is a hollow ring. */
export function SafetyDot({ tone }: { tone: SafetyTone }) {
  const style: CSSProperties =
    tone === 'idle'
      ? { boxShadow: `inset 0 0 0 1.5px ${SAFETY_TONE.idle}` }
      : { backgroundColor: SAFETY_TONE[tone] };
  return <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={style} />;
}

/**
 * One release-safety mechanism as a calm card: its name and a `?` for the
 * explanation, a dot and word for whether it is on, one sentence, its items,
 * and one action. Create and edit forms open from the action, never on the page.
 */
export function SafetyCard({
  id,
  title,
  term,
  help,
  stage,
  word,
  tone,
  sentence,
  action,
  children,
}: {
  id?: string;
  title: string;
  /** The technical name, for whoever searches for it. */
  term?: string;
  help: ReactNode;
  /** "Preview", "Beta": the capability's maturity. */
  stage?: string | null;
  word?: string;
  tone?: SafetyTone;
  sentence: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-label={title}
      tabIndex={id ? -1 : undefined}
      className="surface flex min-w-0 flex-col gap-4 rounded-[1.25rem] bg-card p-5 outline-none"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 items-center gap-1">
          <h3 className="text-sm font-semibold" title={term}>
            {title}
          </h3>
          <HelpTip label={`About ${title.toLowerCase()}`}>{help}</HelpTip>
          {stage && <span className="bento-label ml-1">{stage}</span>}
        </div>
        {word && tone && (
          <span className="flex items-center gap-2 text-xs font-medium">
            <SafetyDot tone={tone} />
            <span className={tone === 'idle' ? 'text-muted-foreground' : undefined}>{word}</span>
          </span>
        )}
      </header>
      <div className="text-[15px] leading-6 text-pretty">{sentence}</div>
      {children}
      {action && <div className="mt-auto flex flex-wrap items-center gap-2">{action}</div>}
    </section>
  );
}

/**
 * A mechanism the account may not have: its card when the capability is on,
 * else the same card saying why not. Children mount, and their reads run,
 * only past the gate, so an unreleased feature never calls a route apid
 * answers with 404 (faas capgate).
 */
export function SafetyCapabilityGate({
  capability,
  title,
  help,
  children,
}: {
  capability: string;
  title: string;
  help: ReactNode;
  children: ReactNode;
}) {
  const { access, refresh } = useCapabilityAccess(capability);
  if (access === 'on') return <>{children}</>;
  return (
    <SafetyCard
      title={title}
      help={help}
      word={access === 'loading' ? 'Checking' : 'Unavailable'}
      tone="idle"
      sentence={
        <p role="status" className="text-muted-foreground">
          {GATE_MESSAGES[access]}
        </p>
      }
      action={
        access === 'off' ? (
          <a className="text-sm text-brand underline" href="/dashboard/settings?section=previews">
            See previews you can join
          </a>
        ) : access === 'plan-not-entitled' ? (
          <a className="text-sm text-brand underline" href="/dashboard/plans">
            View plans
          </a>
        ) : access === 'registry-error' ? (
          <button type="button" className="text-sm text-brand underline" onClick={refresh}>
            Retry
          </button>
        ) : undefined
      }
    />
  );
}

/**
 * A version's one name across the console ("v44", else the short id), from
 * the app's deployments the page already reads. Approvals do not carry the
 * revision, so it is looked up; a version not in the list keeps its short id.
 */
export function useVersionName(slug: string) {
  const deployments = useAppDeployments(slug);
  const items = deployments.data?.pages.flatMap((page) => page.items) ?? [];
  return (deploymentId: string, revision?: number): string => {
    if (revision) return `v${revision}`;
    const found = items.find((d) => d.id === deploymentId);
    return found ? deploymentLabel(found) : deploymentId.slice(0, 8);
  };
}
