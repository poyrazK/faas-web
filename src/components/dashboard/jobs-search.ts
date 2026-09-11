export type JobsSection = 'workloads' | 'scheduled' | 'triggers';

export interface JobsSearch extends Record<string, unknown> {
  section?: JobsSection;
  job?: string;
  run?: string;
  task?: number;
  schedule?: string;
  execution?: string;
  trigger?: string;
  triggerView?: 'records' | 'dlq';
}

export interface JobsSelectionProps {
  search: JobsSearch;
  onSelection: (patch: Partial<JobsSearch>) => void;
}

/** Preserve other owners' search state; validate only the Jobs fields. */
export function validateJobsSearch(raw: Record<string, unknown>): JobsSearch {
  const search = { ...raw } as JobsSearch;
  if (raw.section !== 'workloads' && raw.section !== 'scheduled' && raw.section !== 'triggers')
    search.section = undefined;
  for (const key of ['job', 'run', 'schedule', 'execution', 'trigger'] as const) {
    if (typeof raw[key] !== 'string' || !raw[key].trim()) search[key] = undefined;
  }
  const task = typeof raw.task === 'string' && /^\d+$/.test(raw.task) ? Number(raw.task) : raw.task;
  if (typeof task === 'number' && Number.isSafeInteger(task) && task >= 0) search.task = task;
  else search.task = undefined;
  if (raw.triggerView !== 'records' && raw.triggerView !== 'dlq') search.triggerView = undefined;
  return search;
}
