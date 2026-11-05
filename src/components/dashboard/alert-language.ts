import { isBaseline, metricLabel, metricSpec } from './alert-metrics';

export const COMPARISON_WORDS: Record<string, string> = {
  gt: 'above',
  gte: 'at least',
  lt: 'below',
  lte: 'at most',
  above_baseline: 'above a multiple of usual',
  below_baseline: 'below a fraction of usual',
};

export function alertWindowLabel(window: string): string {
  const match = /^(\d+)(m|h|d)$/.exec(window);
  if (!match) return window;
  const unit = { m: 'minute', h: 'hour', d: 'day' }[match[2]];
  return `${match[1]} ${unit}${match[1] === '1' ? '' : 's'}`;
}

export interface AlertConditionInput {
  metric: string;
  comparison: string;
  threshold: number;
  window_spec: string;
}

/** Keep the comparison literal: a rolling window is not a continuous breach duration. */
export function alertConditionParts(rule: AlertConditionInput) {
  const spec = metricSpec(rule.metric);
  const baseline = isBaseline(rule.comparison);
  const comparison = baseline
    ? rule.comparison === 'above_baseline'
      ? 'above'
      : 'below'
    : (COMPARISON_WORDS[rule.comparison] ?? rule.comparison);
  const unit = spec?.unit;
  const suffix = baseline
    ? '× the usual value'
    : unit === '%'
      ? '%'
      : unit === 'ms'
        ? ' ms'
        : unit === 'seconds'
          ? ' seconds'
          : unit === '× budget'
            ? '× budget'
            : '';
  return {
    subject: metricLabel(rule.metric),
    comparison,
    value: `${rule.threshold}${suffix}`,
    window: spec?.ignoresWindow ? undefined : alertWindowLabel(rule.window_spec),
    baseline,
  };
}

export function explainAlertCondition(rule: AlertConditionInput): string {
  const parts = alertConditionParts(rule);
  return `${parts.subject} is ${parts.comparison} ${parts.value}`;
}

export function alertActionLabel(action: string): string {
  return (
    {
      webhook: 'Send a notification',
      rollback: 'Notify and roll back to the last live deployment',
      demote: 'Notify and hold the canary at its current step',
      promote: 'Notify and promote the canary to 100%',
    }[action] ?? `Action: ${action}`
  );
}
