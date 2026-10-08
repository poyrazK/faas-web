export type JobsSection = 'workloads' | 'scheduled' | 'triggers' | 'automations';

export interface JobsSearch extends Record<string, unknown> {
  section?: JobsSection;
  job?: string;
  run?: string;
  task?: number;
  schedule?: string;
  execution?: string;
  trigger?: string;
  triggerView?: 'records' | 'dlq';
  app?: string;
  automation?: string;
  automationView?: 'editor' | 'runs' | 'revisions';
  automationRun?: string;
  automationNew?: boolean;
}

export interface JobsSelectionProps {
  search: JobsSearch;
  onSelection: (patch: Partial<JobsSearch>) => void;
}

/** Preserve other owners' search state; validate only the Jobs fields. */
export function validateJobsSearch(raw: Record<string, unknown>): JobsSearch {
  const search = { ...raw } as JobsSearch;
  if (
    raw.section !== 'workloads' &&
    raw.section !== 'scheduled' &&
    raw.section !== 'triggers' &&
    raw.section !== 'automations'
  )
    search.section = undefined;
  for (const key of [
    'job',
    'run',
    'schedule',
    'execution',
    'trigger',
    'app',
    'automation',
    'automationRun',
  ] as const) {
    if (typeof raw[key] !== 'string' || !raw[key].trim()) search[key] = undefined;
  }
  const task = typeof raw.task === 'string' && /^\d+$/.test(raw.task) ? Number(raw.task) : raw.task;
  if (typeof task === 'number' && Number.isSafeInteger(task) && task >= 0) search.task = task;
  else search.task = undefined;
  if (raw.triggerView !== 'records' && raw.triggerView !== 'dlq') search.triggerView = undefined;
  if (!['editor', 'runs', 'revisions'].includes(String(raw.automationView)))
    search.automationView = undefined;
  search.automationNew = raw.automationNew === true ? true : undefined;
  return search;
}

export function automationSearchPatch(
  search: JobsSearch
): Pick<JobsSearch, 'automation' | 'automationView' | 'automationRun' | 'automationNew'> {
  return {
    automation: search.automation,
    automationView: search.automationView,
    automationRun: search.automationRun,
    automationNew: search.automationNew,
  };
}
