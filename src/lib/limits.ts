import { formatCents, formatMillicentRate } from './money';

/**
 * The Spending limits page's verdicts, in one place: what the status strip
 * says and each limit's tone. Pure, so every state can be pinned by a test.
 *
 * Precedence (spec 2026-11-23-spending-limits-design.md): data about to be
 * deleted, then stopped workloads, then a limit that is close, then fine. A
 * read that failed is never counted as fine (it reads neutral, not mint), and
 * an organization gets a spend-cap verdict only for a $0 cap, because faas
 * reports no organization overage or egress use.
 */

export type LimitTone = 'good' | 'warning' | 'critical' | 'neutral';

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
  /**
   * `enabled` is the saved election; `billingOff` means egress billing isn't
   * live yet, so the allowance still holds even with the election on.
   */
  egress: Read<{
    enabled: boolean;
    billingOff?: boolean;
    electable: boolean;
    usedGb?: number;
    includedGb?: number;
  }>;
  storage: Read<{
    usedBytes: number;
    ceilingBytes: number;
    overCeiling?: { excessBytes: number; deletionAt: string };
  }>;
  /** Personal compute this month; Free stops at its included hours. */
  compute?: { usedGbHours: number; includedGbHours: number };
  /** The personal usage summary (overage, egress and compute use) failed to load. */
  usageUnknown?: boolean;
  /**
   * Plain sentences for limits outside the bill that are reached and now
   * hold something back (an agent at its budget, while the agents build flag
   * is on). They join the "close" lines; they never stop anything.
   */
  alsoClose?: string[];
}

export interface BillStatus {
  tone: LimitTone;
  headline: string;
  detail: string;
  action?: 'cap' | 'egress' | 'plans' | 'storage';
}

const GIB = 2 ** 30;
/** Whole GiB, or one decimal below 10. */
export const gib = (n: number) => `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10} GiB`;
const pct = (used: number, limit: number) => Math.round((used / limit) * 100);
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The spend cap row's sentence. */
export function capSentence(facts: BillFacts): string {
  const org = facts.workspace === 'org';
  if (facts.workspace === 'personal' && facts.plan === 'free')
    return 'Free stops at its allowance, so there’s no overage to cap.';
  if (facts.cap.state !== 'ready') return '';
  const { capCents } = facts.cap;
  if (capCents === null) return 'No cap is set, so nothing stops overage.';
  if (capCents === 0)
    return org
      ? 'A $0 cap pauses every workload, even within the organization’s allowance.'
      : 'A $0 cap pauses every workload, even within your allowance.';
  return `Apps, jobs and databases stop at ${formatCents(capCents)} of overage.`;
}

/** The egress row's sentence. */
export function egressSentence(e: {
  enabled: boolean;
  billingOff?: boolean;
  electable?: boolean;
  includedGb?: number;
  priceMillicentsPerGib?: number;
  /** A company workspace: the organization's plan and cap, never "your". */
  org?: boolean;
}): string {
  const whose = e.org ? 'the' : 'your';
  const allowance = e.includedGb != null ? gib(e.includedGb) : `${whose} plan’s egress allowance`;
  if (e.enabled && e.billingOff)
    return `Saved. Until egress billing starts, apps still stop at ${allowance}.`;
  if (e.enabled)
    return `Pays ${e.priceMillicentsPerGib != null ? formatMillicentRate(e.priceMillicentsPerGib) : 'the egress rate'} per GiB beyond ${allowance}, counted toward ${whose} spend cap.`;
  if (e.electable === false) return `Apps stop at ${allowance}. Paid plans can pay beyond it.`;
  if (e.billingOff)
    return `Apps stop at ${allowance}. You can choose to pay beyond it now; it starts when egress billing does.`;
  return `Apps stop at ${allowance}. Or pay for egress beyond it.`;
}

const stopped = (
  detail: string,
  action?: BillStatus['action'],
  headline = 'Your apps are stopped'
): BillStatus => ({
  tone: 'critical',
  headline,
  detail,
  ...(action ? { action } : {}),
});

export function billStatus(facts: BillFacts): BillStatus {
  const { cap, egress, storage } = facts;
  const org = facts.workspace === 'org';
  const free = !org && facts.plan === 'free';
  const personalCap = !org && !free;

  // 1. Data about to be deleted.
  if (storage.state === 'ready' && storage.overCeiling)
    return {
      tone: 'critical',
      headline: `Files will be deleted on ${day(storage.overCeiling.deletionAt)}`,
      detail: `Storage is ${gib(storage.overCeiling.excessBytes / GIB)} over its ${gib(storage.ceilingBytes / GIB)} ceiling. Delete files to get back under it, or ask support to raise the ceiling.`,
      action: 'storage',
    };

  // 2. Stopped workloads. A $0 cap is reached at once, whatever the overage.
  if (!free && cap.state === 'ready' && cap.capCents === 0)
    return stopped(
      org
        ? 'This organization’s spend cap is $0, which pauses every workload.'
        : 'Your spend cap is $0, which pauses every workload.',
      'cap',
      org ? 'Workloads are stopped' : undefined
    );
  if (
    personalCap &&
    cap.state === 'ready' &&
    cap.capCents !== null &&
    cap.overageCents != null &&
    cap.overageCents >= cap.capCents
  )
    return stopped(`Overage reached your ${formatCents(cap.capCents)} cap.`, 'cap');
  const compute = free && facts.compute?.includedGbHours ? facts.compute : null;
  if (compute && compute.usedGbHours >= compute.includedGbHours)
    return stopped('Free’s included compute is used up for this month.', 'plans');
  // Paying beyond the allowance only lifts it once egress billing is live.
  const egressMeter =
    egress.state === 'ready' &&
    (!egress.enabled || egress.billingOff) &&
    egress.usedGb != null &&
    egress.includedGb != null &&
    egress.includedGb > 0
      ? { used: egress.usedGb, limit: egress.includedGb }
      : null;
  if (egress.state === 'ready' && egressMeter && egressMeter.used >= egressMeter.limit)
    return stopped(
      `Egress reached ${gib(egressMeter.limit)}.`,
      // Electing to pay lifts the stop only once egress billing is live; until
      // then a bigger plan is the way past the allowance.
      egress.electable && !egress.enabled && !egress.billingOff ? 'egress' : 'plans'
    );

  // 3. Close to a limit.
  const unread = [
    facts.usageUnknown && 'Your usage couldn’t be read.',
    egress.state === 'unknown' && 'Egress couldn’t be read.',
    storage.state === 'unknown' && 'Storage couldn’t be read.',
    cap.state === 'unknown' && 'The spend cap couldn’t be read.',
  ].filter(Boolean) as string[];
  // Keep the usage note last, as it qualifies everything above.
  if (facts.usageUnknown) unread.push(unread.shift()!);
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
  if (compute && meterTone(compute.usedGbHours, compute.includedGbHours) === 'warning')
    close.push(
      `Compute is at ${pct(compute.usedGbHours, compute.includedGbHours)}% of Free’s ${Math.round(compute.includedGbHours).toLocaleString('en')} GB-hours.`
    );
  if (egressMeter && meterTone(egressMeter.used, egressMeter.limit) === 'warning')
    close.push(
      `Egress is at ${pct(egressMeter.used, egressMeter.limit)}% of ${gib(egressMeter.limit)}.`
    );
  if (storageMeter && meterTone(storageMeter.used, storageMeter.limit) !== 'good')
    close.push(
      `Storage is at ${pct(storageMeter.used, storageMeter.limit)}% of ${gib(storageMeter.limit)}.`
    );
  close.push(...(facts.alsoClose ?? []));
  if (close.length)
    return {
      tone: 'warning',
      headline: 'Close to a limit',
      detail: [...close, ...unread].join(' '),
    };

  // 4. Fine, saying only what was checked, with what couldn't be read named.
  const parts: string[] = [];
  if (org)
    parts.push(
      storage.state === 'ready'
        ? 'Gregale doesn’t report this organization’s overage or egress use here, so only storage was checked.'
        : 'Gregale doesn’t report this organization’s overage or egress use here, so neither was checked.'
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
  if (closest && !org)
    parts.push(`${closest.text} is at ${closest.pct}% of ${gib(closest.limit)}.`);
  const unsure = unread.length > 0 || org;
  return {
    tone: unsure ? 'neutral' : 'good',
    // "on your bill": budgets below can still stop previews on their own.
    headline: unsure ? 'Nothing reported stopped' : 'Nothing on your bill is stopped',
    detail: [...parts, ...unread].join(' '),
  };
}
