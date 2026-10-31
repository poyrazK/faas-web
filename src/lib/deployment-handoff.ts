import {
  newAppPath,
  validateNewAppSearch,
  type NewAppSearch,
} from '@/components/dashboard/new-app-source';

const KEY = 'gregale.github-deployment-return';
const MAX_AGE = 60 * 60 * 1000;

/** GitHub returns to Integrations. Keep this tab's explicit deployment intent. */
export function rememberGitHubDeployment(search: NewAppSearch, onboarding = false) {
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        search: validateNewAppSearch(search as Record<string, unknown>),
        onboarding,
        at: Date.now(),
      })
    );
  } catch {
    // The URL still contains the source if browser storage is unavailable.
  }
}

export function consumeGitHubDeployment(): string | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw);
    if (
      !value ||
      typeof value.at !== 'number' ||
      Date.now() - value.at > MAX_AGE ||
      value.at > Date.now() ||
      !value.search ||
      typeof value.search !== 'object'
    )
      return undefined;
    return newAppPath(validateNewAppSearch(value.search), value.onboarding === true);
  } catch {
    return undefined;
  }
}
