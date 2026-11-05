/**
 * The app last picked anywhere in the console, kept per browser. Separate from
 * `app-select.tsx` so a route guard can read it without pulling in the picker.
 */
export const SELECTED_APP_KEY = 'gregale.selectedApp';

/** The remembered app slug, or '' if none. */
export function remembered(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(SELECTED_APP_KEY) ?? '';
}
