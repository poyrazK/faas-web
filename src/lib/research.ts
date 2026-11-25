export interface DatasetDownload {
  name: string;
  path: string;
  encodingFormat: string;
}

interface ResearchPublication {
  slug: string;
  title: string;
  summary: string;
  publishedOn: string;
  measuredOn: string;
  datasetDownloads: readonly DatasetDownload[];
}

export const RESEARCH_TITLE = 'Research & Benchmarks';
export const RESEARCH_DESCRIPTION =
  'Measurements from Gregale infrastructure, with test conditions, downloadable data, and analysis scripts.';

export const FASTAPI_COST_SLUG = 'intermittent-fastapi-cost-2026-11-24';
export const SNAPSHOT_RESTORE_SLUG = 'firecracker-snapshot-restore-ssd-2026-09-09';

export const RESEARCH_PUBLICATIONS: readonly ResearchPublication[] = [
  {
    slug: FASTAPI_COST_SLUG,
    title: 'What it costs to run an intermittent FastAPI app on Gregale',
    summary:
      'Metered compute for the same number of FastAPI requests sent at intervals or in bursts, with 30-day cost estimates.',
    publishedOn: '2026-11-24',
    measuredOn: '2026-11-24',
    datasetDownloads: [
      {
        name: 'Complete reproduction kit (tar.gz)',
        path: 'reproduction.tar.gz',
        encodingFormat: 'application/gzip',
      },
      {
        name: 'Request observations (CSV)',
        path: 'traffic.csv',
        encodingFormat: 'text/csv',
      },
      {
        name: 'Instance state observations (CSV)',
        path: 'states.csv',
        encodingFormat: 'text/csv',
      },
      {
        name: 'Usage ledger captures (JSON)',
        path: 'ledger.json',
        encodingFormat: 'application/json',
      },
      {
        name: 'Calculated results and estimates (JSON)',
        path: 'summary.json',
        encodingFormat: 'application/json',
      },
    ],
  },
  {
    slug: SNAPSHOT_RESTORE_SLUG,
    title: 'Firecracker snapshot restore on SSD',
    summary: 'Scheduler wake timing from 100 sequential snapshot restores on one SSD-backed node.',
    publishedOn: '2026-11-24',
    measuredOn: '2026-09-09',
    datasetDownloads: [
      {
        name: 'Complete reproduction kit (tar.gz)',
        path: 'reproduction.tar.gz',
        encodingFormat: 'application/gzip',
      },
      {
        name: 'Per-request samples (CSV)',
        path: 'samples.csv',
        encodingFormat: 'text/csv',
      },
      {
        name: 'Computed distributions (JSON)',
        path: 'summary.json',
        encodingFormat: 'application/json',
      },
    ],
  },
];

const RELATED_RESEARCH: Record<string, string> = {
  'deploy-fastapi': `[What it costs to run an intermittent FastAPI app on Gregale](/research/${FASTAPI_COST_SLUG}) compares billed compute for spaced requests and bursts and shows how to estimate a monthly cost.`,
  'scale-to-zero': `[Firecracker snapshot restore on SSD](/research/${SNAPSHOT_RESTORE_SLUG}) reports 100 historical measurements of the scheduler interval from \`wake.boot_started\` to \`wake.boot_completed\`.`,
};

export function withRelatedResearch(slug: string, source: string): string {
  const related = RELATED_RESEARCH[slug];
  return related ? `${source.trimEnd()}\n\n## Related research\n\n${related}\n` : source;
}

export function researchDate(date: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(date)
  );
}
