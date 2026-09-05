/**
 * Lightweight route-label lookup shared by document metadata and the console.
 * It deliberately contains no icon or component imports: the public root uses
 * page metadata and must not pull the dashboard navigation graph into its
 * initial bundle.
 */
export const SECTION_LABELS: Record<string, string> = {
  overview: 'Overview',
  workflows: 'Apps',
  templates: 'Templates',
  import: 'Import',
  crons: 'Cron Jobs',
  workers: 'Instances',
  deployments: 'Deployments',
  builds: 'Builds',
  domains: 'Domains',
  'edge-rules': 'Edge Rules',
  storage: 'Storage',
  traces: 'Invocations',
  audit: 'Audit Log',
  usage: 'Usage',
  invoices: 'Invoices',
  plans: 'Plans',
  keys: 'API Keys',
  team: 'Team',
  account: 'Account',
  security: 'Security',
  settings: 'Settings',
  metrics: 'Metrics',
  logs: 'Logs',
  apis: 'Routes',
  secrets: 'Secrets',
  env: 'Env vars',
  queues: 'Queues',
  databases: 'Upstreams',
  alerts: 'Alerts',
  webhooks: 'Webhooks',
};
