/**
 * The Plans page's opening sentence (docs/console-plain-english.md): which
 * plan the account is on and what it includes, from `GET /v1/account` alone.
 * Prices are not in the API, so none are quoted.
 */

const PLAN_NAMES: Record<string, string> = {
  free: 'Free',
  hobby: 'Hobby',
  pro: 'Pro',
  scale: 'Scale',
};

export interface PlanFacts {
  plan: string;
  status?: string;
  limits?: Partial<{ deployed_apps: number; ram_mb: number; included_gb_hours: number }>;
}

export function planAnswer(account: PlanFacts): {
  tone: 'good' | 'warning' | 'critical';
  sentence: string;
} {
  const name = PLAN_NAMES[account.plan] ?? account.plan;
  if (account.status === 'past_due')
    return {
      tone: 'warning',
      sentence: `You're on the ${name} plan, and the last payment didn't go through. Retry it under Subscription below.`,
    };
  if (account.status === 'suspended')
    return {
      tone: 'critical',
      sentence: `You're on the ${name} plan, and the account is suspended.`,
    };
  const { deployed_apps: apps, ram_mb: ram, included_gb_hours: hours } = account.limits ?? {};
  // A partial read says less rather than printing "undefined apps".
  if (typeof apps !== 'number' || typeof ram !== 'number' || typeof hours !== 'number')
    return { tone: 'good', sentence: `You're on the ${name} plan.` };
  const n = (value: number) => value.toLocaleString('en-US');
  return {
    tone: 'good',
    sentence: `You're on the ${name} plan: up to ${n(apps)} apps with ${n(ram)} MB of memory each, and ${n(hours)} GB-hours of compute included every month.`,
  };
}
