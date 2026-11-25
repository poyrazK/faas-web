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

export const AGENT_GUARDRAILS_SLUG = 'agent-ops-guardrails-matrix-2026-11-25';
export const PAAS_COST_MODEL_SLUG = 'paas-intermittent-api-cost-model-2026-11-25';
export const FASTAPI_COST_SLUG = 'intermittent-fastapi-cost-2026-11-24';
export const SNAPSHOT_RESTORE_SLUG = 'firecracker-snapshot-restore-ssd-2026-09-09';

export const RESEARCH_PUBLICATIONS: readonly ResearchPublication[] = [
  {
    slug: AGENT_GUARDRAILS_SLUG,
    title: 'Cloud agent-ops guardrails compared across 8 PaaS platforms',
    summary:
      'Reproducible evaluation of 8 backend platforms across 8 operational safety controls for AI coding agents: non-interactive JSON CLI, official MCP server, scoped agent identity, cost previews, human approval gates, mutation undo, automatic 5xx canary rollbacks and coordinated code + Postgres rollback.',
    publishedOn: '2026-11-25',
    measuredOn: '2026-11-25',
    datasetDownloads: [
      {
        name: 'Complete reproduction kit (tar.gz)',
        path: 'reproduction.tar.gz',
        encodingFormat: 'application/gzip',
      },
      {
        name: 'Guardrail scoring criteria (JSON)',
        path: 'criteria.json',
        encodingFormat: 'application/json',
      },
      {
        name: 'Platform evaluations and sources (JSON)',
        path: 'vendors.json',
        encodingFormat: 'application/json',
      },
      {
        name: 'Calculated matrix summary (JSON)',
        path: 'summary.json',
        encodingFormat: 'application/json',
      },
    ],
  },
  {
    slug: PAAS_COST_MODEL_SLUG,
    title: 'What an intermittent or evenly spaced backend costs across 6 PaaS platforms',
    summary:
      'Deterministic 30-day cost model showing how Gregale’s ~1–2 s between-request pause ladder compares with minute-scale sleep timers on Fly.io, Railway, Render, Heroku and Cloud Run.',
    publishedOn: '2026-11-25',
    measuredOn: '2026-11-25',
    datasetDownloads: [
      {
        name: 'Complete reproduction kit (tar.gz)',
        path: 'reproduction.tar.gz',
        encodingFormat: 'application/gzip',
      },
      {
        name: 'Vendor pricing inputs (JSON)',
        path: 'vendors.json',
        encodingFormat: 'application/json',
      },
      {
        name: 'Workload scenarios (JSON)',
        path: 'scenarios.json',
        encodingFormat: 'application/json',
      },
      {
        name: 'Calculated comparison output (JSON)',
        path: 'summary.json',
        encodingFormat: 'application/json',
      },
    ],
  },
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
  agents: `[Cloud agent-ops guardrails compared across 8 PaaS platforms](/research/${AGENT_GUARDRAILS_SLUG}) evaluates Gregale, Google Cloud Run, Vercel, Northflank, Render, Railway, Fly.io and Koyeb across 8 safety criteria for coding agents.`,
  plans: `[What an intermittent backend costs across 6 PaaS platforms](/research/${PAAS_COST_MODEL_SLUG}) models 30-day spend across Gregale, Render, Railway, Fly.io, Cloud Run and Heroku for 4 API and Postgres workloads.`,
  billing: `[What an intermittent backend costs across 6 PaaS platforms](/research/${PAAS_COST_MODEL_SLUG}) compares Gregale's GB-RAM-hour billing against 5 other platforms across intermittent and always-on workloads.`,
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
