export const SETTINGS_SECTIONS = [
  ['general', 'General'],
  ['organization', 'Organization'],
  ['members', 'Members'],
  ['api-keys', 'API keys'],
  ['security', 'Security'],
  ['integrations', 'Integrations'],
  ['platform-limits', 'Platform limits'],
  ['data-and-privacy', 'Data and privacy'],
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number][0];
export interface SettingsSearch extends Record<string, unknown> {
  section?: SettingsSection;
  scope?: 'personal' | 'organization';
  org?: string;
  github?: string;
  default_branch?: string;
}
export function validateSettingsSearch(raw: Record<string, unknown>): SettingsSearch {
  const search = { ...raw } as SettingsSearch;
  if (!SETTINGS_SECTIONS.some(([section]) => raw.section === section)) search.section = undefined;
  if (raw.scope !== 'personal' && raw.scope !== 'organization') search.scope = undefined;
  for (const key of ['org', 'github', 'default_branch'] as const) {
    if (typeof raw[key] !== 'string' || !raw[key].trim()) search[key] = undefined;
  }
  return search;
}
