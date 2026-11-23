import { formatCents, formatMillicentRate } from './money';

/**
 * The Spending limits page's verdicts, in one place: what the status strip
 * says and each limit's tone. Pure, so every state can be pinned by a test.
 *
 * Precedence (spec 2026-11-23-spending-limits-design.md): data about to be
 * deleted, then stopped workloads, then a limit that is close, then fine. A
 * read that failed is never counted as fine, and an organization never gets a
 * spend-cap verdict, because faas reports no organization overage.
 */

export type LimitTone = 'good' | 'warning' | 'critical';

/** Amber from 80% of the limit, red at it. */
export function meterTone(used: number, limit: number): LimitTone {
  if (used >= limit) return 'critical';
  if (limit > 0 && used / limit >= 0.8) return 'warning';
  return 'good';
}

type Read<T> = ({ state: 'ready' } & T) | { state: 'unknown' } | { state: 'hidden' };

export interface BillFacts {
  workspace: 'personal' | 'org';
  plan?: 'free' | 'hobby' | 'pro' | 'scale';
  /** An organization's `overageCents` is always undefined: faas doesn't report it. */
  cap: Read<{ capCents: number | null; overageCents?: number }>;
  egress: Read<{ enabled: boolean; electable: boolean; usedGb?: number; includedGb?: number }>;
  storage: Read<{
    usedBytes: number;
    ceilingBytes: number;
    overCeiling?: { excessBytes: number; deletionAt: string };
  }>;
}

export interface BillStatus {
  tone: LimitTone;
  headline: string;
  detail: string;
  action?: 'cap' | 'egress' | 'plans' | 'storage';
}

const GIB = 2 ** 30;
/** Whole GiB, or one decimal below 10. */
const gib = (n: number) => `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10} GiB`;
const pct = (used: number, limit: number) => Math.round((used / limit) * 100);
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The spend cap row's sentence. */
export function capSentence(facts: BillFacts): string {
  if (facts.workspace === 'personal' && facts.plan === 'free')
    return 'Free stops at its allowance, so there’s no overage to cap.';
  if (facts.cap.state !== 'ready') return '';
  const { capCents } = facts.cap;
  if (capCents === null) return 'No cap is set, so nothing stops overage.';
  if (capCents === 0) return 'A $0 cap pauses every workload, even within your allowance.';
  return `Apps, jobs and databases stop at ${formatCents(capCents)} of overage.`;
}

/** The egress row's sentence. */
export function egressSentence(e: {
  enabled: boolean;
  electable?: boolean;
  includedGb?: number;
  priceMillicentsPerGib?: number;
}): string {
  const allowance = e.includedGb != null ? gib(e.includedGb) : 'your plan’s egress allowance';
  if (e.enabled)
    return `Pays ${e.priceMillicentsPerGib != null ? formatMillicentRate(e.priceMillicentsPerGib) : 'the egress rate'} per GiB beyond ${allowance}, counted toward your spend cap.`;
  if (e.electable === false) return `Apps stop at ${allowance}. Paid plans can pay beyond it.`;
  return `Apps stop at ${allowance}. Or pay for egress beyond it.`;
}

export function billStatus(facts: BillFacts): BillStatus {
  const { cap, egress, storage } = facts;
  const personalCap = facts.workspace === 'personal' && facts.plan !== 'free';

  // 1. Data about to be deleted.
  if (storage.state === 'ready' && storage.overCeiling)
    return {
      tone: 'critical',
      headline: `Files will be deleted on ${day(storage.overCeiling.deletionAt)}`,
      detail: `Storage is ${gib(storage.overCeiling.excessBytes / GIB)} over its ${gib(storage.ceilingBytes / GIB)} ceiling. Delete files to get back under it, or ask support to raise the ceiling.`,
      action: 'storage',
    };

  // 2. Stopped workloads.
  if (personalCap && cap.state === 'ready' && cap.capCents === 0)
    return {
      tone: 'critical',
      headline: 'Your apps are stopped',
      detail: 'Your spend cap is $0, which pauses every workload.',
      action: 'cap',
    };
  if (
    personalCap &&
    cap.state === 'ready' &&
    cap.capCents !== null &&
    cap.overageCents != null &&
    cap.overageCents >= cap.capCents
  )
    return {
      tone: 'critical',
      headline: 'Your apps are stopped',
      detail: `Overage reached your ${formatCents(cap.capCents)} cap.`,
      action: 'cap',
    };
  const egressMeter =
    egress.state === 'ready' &&
    !egress.enabled &&
    egress.usedGb != null &&
    egress.includedGb != null &&
    egress.includedGb > 0
      ? { used: egress.usedGb, limit: egress.includedGb }
      : null;
  if (egress.state === 'ready' && egressMeter && egressMeter.used >= egressMeter.limit)
    return {
      tone: 'critical',
      headline: 'Your apps are stopped',
      detail: `Egress reached ${gib(egressMeter.limit)}.`,
      action: egress.electable ? 'egress' : 'plans',
    };

  // 3. Close to a limit.
  const unread = [
    egress.state === 'unknown' && 'Egress couldn’t be read.',
    storage.state === 'unknown' && 'Storage couldn’t be read.',
    cap.state === 'unknown' && 'The spend cap couldn’t be read.',
  ].filter(Boolean) as string[];
  const storageMeter =
    storage.state === 'ready' && storage.ceilingBytes > 0
      ? { used: storage.usedBytes / GIB, limit: storage.ceilingBytes / GIB }
      : null;
  const close: string[] = [];
  if (personalCap && cap.state === 'ready') {
    if (cap.capCents === null) close.push('No cap is set, so nothing stops overage.');
    else if (cap.overageCents != null && meterTone(cap.overageCents, cap.capCents) === 'warning')
      close.push(
        `Overage is at ${pct(cap.overageCents, cap.capCents)}% of your ${formatCents(cap.capCents)} cap.`
      );
  }
  if (egressMeter && meterTone(egressMeter.used, egressMeter.limit) === 'warning')
    close.push(
      `Egress is at ${pct(egressMeter.used, egressMeter.limit)}% of ${gib(egressMeter.limit)}.`
    );
  if (storageMeter && meterTone(storageMeter.used, storageMeter.limit) !== 'good')
    close.push(
      `Storage is at ${pct(storageMeter.used, storageMeter.limit)}% of ${gib(storageMeter.limit)}.`
    );
  if (close.length)
    return {
      tone: 'warning',
      headline: 'Close to a limit',
      detail: [...close, ...unread].join(' '),
    };

  // 4. Fine, with what couldn't be read named.
  const parts: string[] = [];
  if (facts.workspace === 'org')
    parts.push(
      'Gregale doesn’t report this organization’s overage here, so the spend cap’s use isn’t shown.'
    );
  else if (personalCap && cap.state === 'ready' && cap.capCents && cap.overageCents != null)
    parts.push(
      `${formatCents(cap.overageCents)} of your ${formatCents(cap.capCents)} overage cap used.`
    );
  const closest = [
    egressMeter && {
      pct: pct(egressMeter.used, egressMeter.limit),
      text: 'Egress',
      limit: egressMeter.limit,
    },
    storageMeter && {
      pct: pct(storageMeter.used, storageMeter.limit),
      text: 'Storage',
      limit: storageMeter.limit,
    },
  ]
    .filter((m): m is { pct: number; text: string; limit: number } => Boolean(m))
    .sort((a, b) => b.pct - a.pct)[0];
  if (closest && facts.workspace === 'personal')
    parts.push(`${closest.text} is at ${closest.pct}% of ${gib(closest.limit)}.`);
  return {
    tone: 'good',
    headline: unread.length
      ? 'Nothing reported stopped'
      : facts.workspace === 'org'
        ? 'No other limit is stopped'
        : 'Nothing is stopped',
    detail: [...parts, ...unread].join(' '),
  };
}
