/**
 * The popups a release page can open, named in its URL as `?panel=`.
 *
 * The page replaced a seven-tab dialog addressed by `?releaseSection=`; old
 * links still carry that, so `panelForSection` maps a section onto the popup
 * that now holds its content.
 */
export const RELEASE_PANELS = [
  'changes',
  'output',
  'rollout',
  'runtime',
  'security',
  'provenance',
  'release-command',
  'canary',
  'activity',
  'details',
] as const;

export type ReleasePanel = (typeof RELEASE_PANELS)[number];

export interface ReleasePageSearch extends Record<string, unknown> {
  panel?: ReleasePanel;
  sandbox?: true;
  sandboxScenario?: string;
}

export function isReleasePanel(value: unknown): value is ReleasePanel {
  return typeof value === 'string' && (RELEASE_PANELS as readonly string[]).includes(value);
}

export function validateReleasePageSearch(raw: Record<string, unknown>): ReleasePageSearch {
  const { panel, sandbox, sandboxScenario, ...rest } = raw;
  return {
    ...rest,
    ...(isReleasePanel(panel) ? { panel } : {}),
    ...(sandbox === true ? { sandbox } : {}),
    ...(typeof sandboxScenario === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sandboxScenario)
      ? { sandboxScenario }
      : {}),
  };
}

const SECTION_PANELS: Record<string, ReleasePanel> = {
  output: 'output',
  provenance: 'provenance',
  scans: 'security',
  lifecycle: 'rollout',
  runtime: 'runtime',
  audit: 'activity',
};

/** The popup an old `releaseSection` opens; the overview opens none. */
export function panelForSection(section: unknown): ReleasePanel | undefined {
  return typeof section === 'string' ? SECTION_PANELS[section] : undefined;
}
