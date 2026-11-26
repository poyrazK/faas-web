import type { BeforeSendEvent } from '@vercel/analytics';

/** SDK events also include the current URL; source and return queries are private. */
export function onboardingAnalyticsPrivacy(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url);
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    if (path.startsWith('/api-sandbox/')) return null;
    if (!['/onboarding', '/login', '/signup', '/will-it-run', '/dashboard/apps/new'].includes(path))
      return event;
    url.search = '';
    url.hash = '';
    return { ...event, url: url.toString() };
  } catch {
    return null;
  }
}
