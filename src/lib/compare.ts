import { formatCatalogPrice, type CatalogPlan } from './plan-catalog-parser.ts';
import type { FaqEntry } from './faq.ts';

/**
 * Comparison pages: /vs/<slug>.
 *
 * Plain TypeScript for the same reason as `faq.ts`: the page renders it and
 * `scripts/prerender.mjs` reads it with plain Node, for the route list and the
 * FAQ structured data. Nothing here may import JSX or a `?raw` module.
 *
 * Rules for this copy:
 * - Every Gregale figure is computed from the generated plan catalog, never
 *   typed, so a price change updates every page.
 * - Every competitor figure comes from that competitor's own pricing page or
 *   docs, listed in `sources`, and is dated by `COMPARISONS_CHECKED`. Re-check
 *   them before changing that date. Third-party summaries are not a source.
 * - Each page says where the competitor is the better choice. A comparison
 *   that only flatters Gregale is not believed, and it is not true.
 */

/** When the competitor figures below were last read from their sources. */
export const COMPARISONS_CHECKED = '2026-11-26';

interface Catalog {
  currency: string;
  overagePerGbHour: number;
  plans: CatalogPlan[];
}

export interface ComparisonRow {
  topic: string;
  gregale: string;
  them: string;
}

export interface Comparison {
  slug: string;
  competitor: string;
  /** Meta description and the line under the heading. */
  summary: string;
  rows: ComparisonRow[];
  /** Where the competitor is the better fit. */
  theyFit: string[];
  /** Where Gregale is the better fit. */
  gregaleFits: string[];
  /** Docs slug for moving an app over. */
  migrateDoc: string;
  migrateLabel: string;
  /**
   * Three to five answer articles for someone weighing this competitor; the
   * page links these instead of every article, so each /vs page stays its own.
   */
  articles: string[];
  faq: FaqEntry[];
  sources: { label: string; url: string }[];
}

const HOURS_PER_MONTH = 730;

function gregaleFacts(catalog: Catalog) {
  const usd = (amount: number) => formatCatalogPrice(amount, catalog.currency);
  const [free, ...paid] = catalog.plans;
  const hobby = paid.reduce((low, plan) => (plan.monthly < low.monthly ? plan : low), paid[0]);
  const gb = hobby.ramMb / 1024;
  // An app of the cheapest paid plan's size, awake all month.
  const alwaysOnGbHours = gb * HOURS_PER_MONTH;
  const alwaysOnCost =
    hobby.monthly + Math.max(0, alwaysOnGbHours - hobby.includedGbHours) * catalog.overagePerGbHour;
  // The same app awake about eight hours a day.
  const partTimeGbHours = Math.round(gb * 8 * (HOURS_PER_MONTH / 24));
  const apps = (n: number) => `${n} ${n === 1 ? 'app' : 'apps'}`;
  return {
    usd,
    hobby,
    hobbyRam: `${hobby.ramMb} MB`,
    alwaysOn: usd(Math.round(alwaysOnCost * 100) / 100),
    partTimeGbHours,
    partTimeFits: partTimeGbHours <= hobby.includedGbHours,
    rows: {
      free:
        `Gregale ${free.name}: ${usd(free.monthly)}, ${apps(free.deployedApps)} with ${free.ramMb} MB and ` +
        `${free.includedGbHours} GB-RAM-hours a month. It stops at the allowance rather than billing you.`,
      paid:
        `Gregale ${hobby.name}: ${usd(hobby.monthly)} a month for ${apps(hobby.deployedApps)} with ` +
        `${hobby.ramMb} MB each and ${hobby.includedGbHours} GB-RAM-hours included.`,
      billing:
        `By memory and time (GB-RAM-hours), CPU included, and only while an instance is ` +
        `running: paused and parked time is not billed. Beyond a Gregale plan's allowance, ` +
        `${usd(catalog.overagePerGbHour)} per GB-RAM-hour, up to a spend cap you set.`,
      idle:
        'About a second after its last request, an idle app pauses and stops being billed; the ' +
        'next request resumes it in milliseconds. After 10 minutes it parks to a snapshot. An ' +
        'app doing background work keeps running, and billed, while it works. On every plan.',
      isolation: 'A Firecracker microVM per instance.',
      postgres: `Managed PostgreSQL on ${hobby.name} and above, bound to the app as DATABASE_URL.`,
      previews: 'A preview environment per open pull request, on every plan including Free.',
      disk: 'No durable local disk. Keep state in managed PostgreSQL or object storage.',
      regions: 'One region today.',
      releases:
        'Every production release of a live app climbs a ladder: 1%, then 10%, 50% and 100% ' +
        'of real traffic, advancing only while the new version shows no errors, OOM kills or ' +
        'restarts, and rolling back on its own if it starts returning 5xx. On by default, on ' +
        'every plan; a typical release reaches 100% in 3 to 5 minutes.',
    },
  };
}

export function comparisons(catalog: Catalog): Comparison[] {
  const g = gregaleFacts(catalog);
  const costAnswer = (them: string) =>
    `It depends on how much of the day your app is actually serving. Gregale stops billing ` +
    `about a second after each request, so an API is billed for the time it spends ` +
    `answering, not the time it is up. A ${g.hobbyRam} app that serves for about eight hours ` +
    `a day uses around ` +
    `${g.partTimeGbHours} GB-RAM-hours a month, which ` +
    (g.partTimeFits
      ? `fits inside ${g.hobby.name}'s ${g.usd(g.hobby.monthly)} plan. `
      : `goes beyond ${g.hobby.name}'s allowance. `) +
    `The same app serving around the clock costs about ${g.alwaysOn} on Gregale, and ${them}`;

  return [
    {
      slug: 'heroku',
      competitor: 'Heroku',
      summary:
        'Gregale vs Heroku: pricing, idle apps, safe releases, databases and previews compared, ' +
        'and how to move a Heroku app without code changes.',
      rows: [
        {
          topic: 'Free plan',
          gregale: g.rows.free,
          them: 'No free plan. Heroku Eco dynos are $5 a month and sleep after 30 minutes idle.',
        },
        {
          topic: 'Cheapest paid option',
          gregale: g.rows.paid,
          them: 'Heroku Basic dyno: $7 a month, 0.5 GB, always on. Eco is cheaper but personal accounts only.',
        },
        {
          topic: 'How compute is billed',
          gregale: g.rows.billing,
          them: 'A monthly price per dyno. Each web and worker process is its own dyno.',
        },
        {
          topic: 'Idle apps',
          gregale: g.rows.idle,
          them: 'Eco dynos sleep after 30 minutes. Basic and larger dynos run all the time.',
        },
        {
          topic: 'Releases',
          gregale: g.rows.releases,
          them: 'Preboot (Standard and Performance dynos) starts the new dynos before stopping the old ones. Rolling back is a manual command.',
        },
        {
          topic: 'Postgres',
          gregale: g.rows.postgres,
          them: 'Heroku Postgres, from $5 a month (Essential-0, 1 GB).',
        },
        {
          topic: 'Preview environments',
          gregale: g.rows.previews,
          them: 'Review apps, with Heroku Pipelines.',
        },
        {
          topic: 'Isolation',
          gregale: g.rows.isolation,
          them: 'Dynos are managed containers. Private Spaces add network isolation.',
        },
        {
          topic: 'Regions',
          gregale: g.rows.regions,
          them: 'Several. Private Spaces are available in ten regions.',
        },
      ],
      theyFit: [
        'You depend on Heroku add-ons, or on Shield dynos for compliance such as PCI.',
        'You need to choose between several regions or run in an isolated private network.',
        'Your app is busy around the clock, where a $7 Basic dyno costs less than paying by the hour.',
      ],
      gregaleFits: [
        'You want every release to reach real traffic gradually and roll itself back if it fails.',
        'You want a free plan to start, or apps that cost nothing while nobody is using them.',
        'You run several small APIs or services that are idle much of the day.',
        'You want a preview environment for every pull request without extra setup.',
      ],
      migrateDoc: 'migrate-from-heroku',
      migrateLabel: 'Migrate from Heroku',
      articles: [
        'scale-to-zero-without-cold-starts',
        'canary-deploys',
        'rollback-code-and-database',
        'deploy-rails-postgres',
      ],
      faq: [
        {
          question: 'Is Gregale cheaper than Heroku?',
          answer: costAnswer(
            'a Heroku Basic dyno with 0.5 GB is $7 a month, so Heroku is cheaper for an app that never idles.'
          ),
        },
        {
          question: 'Can I move a Heroku app without changing code?',
          answer:
            'Usually, yes. Gregale reads the same Procfile, including its release command, builds ' +
            'Node, Python and Go from source without a Dockerfile, and takes config vars as ' +
            'environment variables and secrets. Heroku Scheduler jobs become crons and worker ' +
            'dynos become background services.',
        },
        {
          question: 'Does Gregale have a free plan like Heroku used to?',
          answer:
            `Yes. ${g.rows.free} Heroku's cheapest option is the $5 Eco plan, which sleeps after ` +
            '30 minutes.',
        },
        {
          question: 'What happens if a release breaks?',
          answer:
            'On Gregale, a production release first gets 1% of traffic, then 10%, 50% and ' +
            '100%, and only moves up while the new version is answering cleanly. If it starts ' +
            'returning 5xx errors, it rolls back to the previous version on its own, so most ' +
            'users never see the bad release. ' +
            'On Heroku, a release replaces the running dynos and you roll back with heroku releases:rollback.',
        },
      ],
      sources: [{ label: 'Heroku pricing', url: 'https://www.heroku.com/pricing/' }],
    },
    {
      slug: 'render',
      competitor: 'Render',
      summary:
        'Gregale vs Render: free tier spin-down, instance pricing, safe releases and databases ' +
        'compared, and how to move a Render web service.',
      rows: [
        {
          topic: 'Free plan',
          gregale: g.rows.free,
          them:
            'Free web services (512 MB) spin down after 15 minutes without traffic and take about ' +
            'a minute to spin back up. 750 free instance hours a month per workspace.',
        },
        {
          topic: 'Cheapest paid option',
          gregale: g.rows.paid,
          them: 'Render Starter instance: $7 a month, 512 MB and 0.5 CPU, always on.',
        },
        {
          topic: 'How compute is billed',
          gregale: g.rows.billing,
          them: 'A Render workspace plan (Hobby $0, Pro $25 a month) plus a monthly price per instance.',
        },
        {
          topic: 'Idle apps',
          gregale: g.rows.idle,
          them: 'Only Free web services spin down. Paid instances run all the time.',
        },
        {
          topic: 'Releases',
          gregale: g.rows.releases,
          them: 'Zero-downtime deploys: the new instance takes all traffic once it is healthy. Rolling back is manual.',
        },
        {
          topic: 'Postgres',
          gregale: g.rows.postgres,
          them: 'Render Postgres. Free databases expire 30 days after they are created.',
        },
        {
          topic: 'Preview environments',
          gregale: g.rows.previews,
          them: 'Preview environments.',
        },
        {
          topic: 'Local disk',
          gregale: g.rows.disk,
          them: 'Render persistent disks on paid services, $0.25 per GB a month.',
        },
        {
          topic: 'Static sites',
          gregale: 'Not a focus: Gregale runs APIs, services and background work.',
          them: 'Free static sites.',
        },
      ],
      theyFit: [
        'You need a persistent disk attached to a service.',
        'You host static sites alongside your services.',
        'Your service is busy around the clock, where a $7 Starter instance costs less.',
      ],
      gregaleFits: [
        'You want every release to reach real traffic gradually and roll itself back if it fails.',
        'You want paid apps to park when idle too, not only free ones.',
        'You want an idle app to wake from a snapshot instead of starting a fresh process.',
        'You run several small APIs and want them on one plan with a spend cap.',
      ],
      migrateDoc: 'migrate-from-render',
      migrateLabel: 'Migrate from Render',
      articles: [
        'show-waking-up-page-during-cold-start',
        'fastapi-background-jobs-postgres',
        'preview-environments',
        'fix-cors-errors-without-changing-backend-code',
      ],
      faq: [
        {
          question: 'Is Gregale cheaper than Render?',
          answer: costAnswer(
            'a Render Starter instance with 512 MB is $7 a month, so Render is cheaper for an app that never idles.'
          ),
        },
        {
          question: 'Can I move a Render web service without changing code?',
          answer:
            'Usually, yes. Both build from source or a Dockerfile, set PORT and pass configuration ' +
            'as environment variables. Gregale does not read render.yaml: its settings map to ' +
            'gregale.yaml, and the pre-deploy command becomes a release command.',
        },
        {
          question: 'Do Gregale apps spin down like Render free services?',
          answer:
            'Yes, and much sooner: on every plan, an idle app pauses about a second after its ' +
            'last request and stops being billed, then resumes in milliseconds. Render free ' +
            'services wait 15 minutes and take about a minute to spin back up. After 10 minutes ' +
            'a Gregale app parks to a snapshot of its running state instead of shutting down.',
        },
        {
          question: 'What happens if a release breaks?',
          answer:
            'On Gregale, a production release first gets 1% of traffic, then 10%, 50% and ' +
            '100%, and only moves up while the new version is answering cleanly. If it starts ' +
            'returning 5xx errors, it rolls back to the previous version on its own, so most ' +
            'users never see the bad release. ' +
            'On Render, the new instance takes all traffic once it is healthy, and you roll back from the dashboard.',
        },
      ],
      sources: [
        { label: 'Render pricing', url: 'https://render.com/pricing' },
        { label: 'Render free instances', url: 'https://render.com/docs/free' },
      ],
    },
    {
      slug: 'railway',
      competitor: 'Railway',
      summary:
        'Gregale vs Railway: plans, usage-based pricing, sleeping services and safe releases ' +
        'compared, and how to move a Railway service to Gregale.',
      rows: [
        {
          topic: 'Free plan',
          gregale: g.rows.free,
          them:
            'Railway Free: $0 with $1 of usage a month. Services sleep after 5 to 10 minutes without outbound ' +
            'traffic. Up to 1 vCPU and 0.5 GB per service.',
        },
        {
          topic: 'Cheapest paid option',
          gregale: g.rows.paid,
          them: 'Railway Hobby: $5 a month, which includes $5 of usage.',
        },
        {
          topic: 'How compute is billed',
          gregale: g.rows.billing,
          them: 'Railway bills usage by the second: memory $10 per GB a month, CPU $20 per vCPU a month, egress $0.05 per GB.',
        },
        {
          topic: 'Idle apps',
          gregale: g.rows.idle,
          them:
            'Free services sleep when idle. Other services run, and bill, all the time unless you turn on ' +
            'the Serverless setting, which sleeps a service 5 to 10 minutes after its last outbound ' +
            'traffic and charges no compute while it sleeps. The first request after a sleep may return a 502.',
        },
        {
          topic: 'Releases',
          gregale: g.rows.releases,
          them: 'Health-checked deploys: the new deployment takes over once it is healthy. Rolling back is manual, from the dashboard.',
        },
        {
          topic: 'Databases',
          gregale: g.rows.postgres,
          them: 'One-click Postgres, Redis, MySQL and MongoDB.',
        },
        {
          topic: 'Local disk',
          gregale: g.rows.disk,
          them: 'Railway volumes, $0.15 per GB a month.',
        },
      ],
      theyFit: [
        'Your app runs all day: Railway charges less per GB of memory for a process that never stops.',
        'You want Redis, MySQL or MongoDB alongside Postgres in one click.',
        'You need a volume for files that survive restarts.',
      ],
      gregaleFits: [
        'You want every release to reach real traffic gradually and roll itself back if it fails.',
        'Your apps are idle much of the day, and you only want to pay while they serve.',
        'You want CPU included in the memory price instead of metered separately.',
        'You want a monthly allowance with a hard spend cap instead of open-ended usage.',
      ],
      migrateDoc: 'migrate-from-railway',
      migrateLabel: 'Migrate from Railway',
      articles: [
        'railway-json-config-as-code-deprecated',
        'rate-limit-api-per-ip-without-code',
        'hard-cloud-spend-caps',
        'nodejs-api-and-worker',
      ],
      faq: [
        {
          question: 'Is Gregale cheaper than Railway?',
          answer: costAnswer(
            'Railway charges $10 per GB of memory a month plus CPU, so for an app that never ' +
              'idles Railway is usually cheaper.'
          ),
        },
        {
          question: 'Can I move a Railway service to Gregale?',
          answer:
            'Usually without code changes. Gregale builds Node, Python and Go from source, or ' +
            'uses your Dockerfile, reads the start command in a railpack.json, and takes ' +
            'configuration as environment variables and secrets. The pre-deploy command becomes ' +
            'a release command; move the database with pg_dump.',
        },
        {
          question: 'Do Gregale apps sleep like Railway free services?',
          answer:
            'Yes, on every plan and sooner: an idle app pauses about a second after its last ' +
            'request and stops being billed, then resumes in milliseconds; after 10 minutes it ' +
            'parks to a snapshot. Railway services sleep only on the Free plan or with the ' +
            'Serverless setting, 5 to 10 minutes after their last outbound traffic. Use ' +
            'min_instances to keep an app warm.',
        },
        {
          question: 'What happens if a release breaks?',
          answer:
            'On Gregale, a production release first gets 1% of traffic, then 10%, 50% and ' +
            '100%, and only moves up while the new version is answering cleanly. If it starts ' +
            'returning 5xx errors, it rolls back to the previous version on its own, so most ' +
            'users never see the bad release. ' +
            'On Railway, the new deployment takes over once it is healthy, and you roll back from the dashboard.',
        },
      ],
      sources: [
        { label: 'Railway pricing', url: 'https://railway.com/pricing' },
        { label: 'Railway plans', url: 'https://docs.railway.com/reference/pricing/plans' },
        { label: 'Railway Serverless', url: 'https://docs.railway.com/reference/app-sleeping' },
      ],
    },
    {
      slug: 'fly',
      competitor: 'Fly.io',
      summary:
        'Gregale vs Fly.io: free plan, Machine pricing, auto-stop and canary releases compared, and ' +
        'what moving an app to Gregale involves.',
      rows: [
        {
          topic: 'Free plan',
          gregale: g.rows.free,
          them: 'Fly.io Free plan: $5 of usage every month, up to 3 Machines.',
        },
        {
          topic: 'Cheapest paid option',
          gregale: g.rows.paid,
          them:
            'Fly.io Pay As You Go, no monthly fee. A shared-cpu-1x Machine is $2.19 a month with 256 MB ' +
            'or $6.70 with 1 GB.',
        },
        {
          topic: 'How compute is billed',
          gregale: g.rows.billing,
          them:
            'Fly.io bills by the second while a Machine runs. A stopped Machine bills only its root ' +
            'filesystem, $0.15 per GB a month.',
        },
        {
          topic: 'Idle apps',
          gregale: g.rows.idle,
          them: 'Machines can stop or suspend when idle and start again on the next request.',
        },
        {
          topic: 'Releases',
          gregale: g.rows.releases,
          them: 'Rolling by default; you can choose canary (one new Machine is health-checked, then a rolling restart) or blue-green.',
        },
        {
          topic: 'Isolation',
          gregale: g.rows.isolation,
          them: 'Firecracker microVMs (Machines).',
        },
        {
          topic: 'Postgres',
          gregale: g.rows.postgres,
          them: 'Managed Postgres. A Developer database fits in the Free plan.',
        },
        {
          topic: 'Local disk',
          gregale: g.rows.disk,
          them: 'Fly.io volumes, $0.15 per GB a month.',
        },
        {
          topic: 'Regions',
          gregale: g.rows.regions,
          them: 'Many regions worldwide, from Amsterdam and Tokyo to São Paulo and Johannesburg.',
        },
      ],
      theyFit: [
        'You want to run close to users in many regions.',
        'You want low-level control of each Machine, its size and its volumes.',
        'Your app runs all day: Fly charges less per GB of memory for an always-on Machine.',
      ],
      gregaleFits: [
        'You want every release to reach real traffic gradually and roll itself back if it fails.',
        'You want to deploy from source without writing infrastructure configuration.',
        'You want preview environments, crons and background services built in.',
        'You want a monthly allowance with a hard spend cap.',
      ],
      migrateDoc: 'migrate-from-fly',
      migrateLabel: 'Migrate from Fly.io',
      articles: [
        'microvm-isolation',
        'deploy-docker-compose-app-to-production',
        'websockets-sse-scale-to-zero',
        'chained-cold-starts-wake-services-together',
      ],
      faq: [
        {
          question: 'Is Gregale cheaper than Fly.io?',
          answer: costAnswer(
            'a Fly.io shared-cpu-1x Machine with 1 GB is $6.70 a month, so Fly.io is cheaper for ' +
              'an app that never idles.'
          ),
        },
        {
          question: 'Can I move a Fly.io app to Gregale?',
          answer:
            'Usually. If your app builds from a Dockerfile, Gregale can run that image, and the ' +
            'fly.toml settings map to gregale.yaml: release_command becomes a release command and ' +
            'the health check path becomes hosting.health. Apps that rely on a volume need their files ' +
            'moved to managed PostgreSQL or object storage, because Gregale instances have no ' +
            'durable local disk.',
        },
        {
          question: 'Do both use Firecracker?',
          answer:
            'Yes. Both run each instance in a Firecracker microVM. Gregale manages the instances ' +
            'for you and parks idle apps automatically.',
        },
        {
          question: 'What happens if a release breaks?',
          answer:
            'On Gregale, a production release first gets 1% of traffic, then 10%, 50% and ' +
            '100%, and only moves up while the new version is answering cleanly. If it starts ' +
            'returning 5xx errors, it rolls back to the previous version on its own, so most ' +
            'users never see the bad release. ' +
            'On Fly.io, a canary deploy health-checks one new Machine and then replaces the rest; there is no step-by-step traffic shift.',
        },
      ],
      sources: [
        { label: 'Fly.io pricing', url: 'https://fly.io/pricing/' },
        { label: 'Fly.io resource pricing', url: 'https://fly.io/docs/about/pricing/' },
      ],
    },
    {
      slug: 'cloud-run',
      competitor: 'Google Cloud Run',
      summary:
        'Gregale vs Google Cloud Run: request-based pricing, cold starts, automatic canary ' +
        'rollbacks, managed PostgreSQL and preview environments compared.',
      rows: [
        {
          topic: 'Free plan',
          gregale: g.rows.free,
          them:
            '180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million requests a month in ' +
            'Tier 1 regions (with a Google Cloud billing account attached).',
        },
        {
          topic: 'Cheapest paid option',
          gregale: g.rows.paid,
          them:
            'Pay per use: $0.00002400 per vCPU-second, $0.00000250 per GiB-second and ' +
            '$0.40 per million requests in Tier 1 regions.',
        },
        {
          topic: 'How compute is billed',
          gregale: g.rows.billing,
          them:
            'Request-based billing charges while starting, shutting down or handling a request ' +
            '(rounded to 100 ms); instance-based billing charges for the whole lifetime.',
        },
        {
          topic: 'Idle apps',
          gregale: g.rows.idle,
          them:
            'Scales to zero after traffic stops and shuts down the container; minimum warm ' +
            'instances stay billed continuously.',
        },
        {
          topic: 'Releases',
          gregale: g.rows.releases,
          them:
            'Revisions shift 100% by default; manual traffic splitting is built in, while ' +
            'automated canary phases and rollbacks require Google Cloud Deploy.',
        },
        {
          topic: 'Isolation',
          gregale: g.rows.isolation,
          them: 'gVisor container sandbox.',
        },
        {
          topic: 'Postgres',
          gregale: g.rows.postgres,
          them:
            'Not bundled. Connect Cloud SQL (starting separately at per-hour instance rates) ' +
            'and manage IAM or VPC connectors yourself.',
        },
        {
          topic: 'Preview environments',
          gregale: g.rows.previews,
          them: 'Revision tags give tagged URLs; per-PR databases and teardown must be wired in CI.',
        },
        {
          topic: 'Local disk',
          gregale: g.rows.disk,
          them: 'Ephemeral in-memory disk (counts toward instance RAM) or Cloud Storage FUSE.',
        },
        {
          topic: 'Regions',
          gregale: g.rows.regions,
          them: 'Dozens of Google Cloud regions worldwide with global Cloud Load Balancing.',
        },
      ],
      theyFit: [
        'Your backend already uses BigQuery, Pub/Sub, Cloud SQL or Google Cloud IAM inside a GCP VPC.',
        'You need multi-region Google Cloud placement or hundreds of auto-scaled containers.',
        'Your request volume stays inside Cloud Run’s monthly free allowance.',
      ],
      gregaleFits: [
        'You want managed PostgreSQL, PR previews, crons and custom domains in one CLI without assembling GCP IAM, Cloud SQL and load balancers.',
        'You want automatic percentage canary rollouts that roll back on 5xx errors without setting up Cloud Deploy.',
        'You want predictable monthly allowances, a hard spend cap and scoped keys for AI coding agents.',
      ],
      migrateDoc: 'migrate-from-cloud-run',
      migrateLabel: 'Migrate from Google Cloud Run',
      articles: [
        'deploy-docker-container-scale-to-zero-no-rewrite',
        'static-egress-ip-scale-to-zero',
        'synthetic-uptime-checks-scale-to-zero',
        'zero-secret-outbound-api-relay',
      ],
      faq: [
        {
          question: 'Is Gregale cheaper than Google Cloud Run?',
          answer: costAnswer(
            'Cloud Run can be free under its monthly Tier 1 allowance or cheap for sparse ' +
              'bursts, though keeping a minimum warm instance or adding Cloud SQL adds continuous ' +
              'GCP charges.'
          ),
        },
        {
          question: 'Can I move a Google Cloud Run service to Gregale?',
          answer:
            'Yes. Any Dockerfile or standard HTTP server listening on PORT deploys directly with ' +
            '`gregale deploy`. Replace Secret Manager mounts with environment variables and bind ' +
            'bundled managed PostgreSQL via DATABASE_URL.',
        },
        {
          question: 'Does Google Cloud Run include managed Postgres or PR previews?',
          answer:
            'No. Cloud SQL is a separate paid Google Cloud service that you connect over a Cloud SQL ' +
            'proxy or VPC connector, and full PR preview environments require your own CI workflow.',
        },
        {
          question: 'What happens if a release breaks?',
          answer:
            'On Gregale, a production release first gets 1% of traffic, then 10%, 50% and ' +
            '100%, and only moves up while the new version is answering cleanly. If it starts ' +
            'returning 5xx errors, it rolls back to the previous version on its own. ' +
            'On Cloud Run, you split traffic manually across revisions or wire Cloud Deploy for automated rollbacks.',
        },
      ],
      sources: [
        { label: 'Google Cloud Run pricing', url: 'https://cloud.google.com/run/pricing' },
        {
          label: 'Cloud Run traffic migration',
          url: 'https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration',
        },
      ],
    },
    {
      slug: 'vercel',
      competitor: 'Vercel',
      summary:
        'Gregale vs Vercel: backend services, Fluid Compute pricing, function duration limits, ' +
        'managed Postgres, canary rollbacks and Firecracker isolation compared.',
      rows: [
        {
          topic: 'Free plan',
          gregale: g.rows.free,
          them:
            'Vercel Hobby is $0 (non-commercial) with 4 Active CPU hours, 360 GB-hours of ' +
            'Provisioned Memory and 1 million invocations a month.',
        },
        {
          topic: 'Cheapest paid option',
          gregale: g.rows.paid,
          them: 'Vercel Pro is $20 a month per deploying team seat (includes $20 of usage credit).',
        },
        {
          topic: 'How compute is billed',
          gregale: g.rows.billing,
          them:
            'Fluid Compute bills Active CPU hours while code executes plus Provisioned Memory ' +
            'GB-hours across the instance lifetime.',
        },
        {
          topic: 'Idle apps',
          gregale: g.rows.idle,
          them:
            'Functions freeze between bursts and un-billed CPU waits during I/O; long-running ' +
            'daemons or persistent WebSocket servers are outside the function model.',
        },
        {
          topic: 'Releases',
          gregale: g.rows.releases,
          them:
            'New deploys go live atomically with instant manual rollback; Rolling Releases are ' +
            'available on Pro and Enterprise.',
        },
        {
          topic: 'Isolation',
          gregale: g.rows.isolation,
          them: 'Sandboxed function runtimes / Fluid Compute microVMs.',
        },
        {
          topic: 'Postgres',
          gregale: g.rows.postgres,
          them: 'Third-party databases installed via Vercel Marketplace integrations.',
        },
        {
          topic: 'Preview environments',
          gregale: g.rows.previews,
          them: 'Unique preview URL created automatically for every Git branch and pull request.',
        },
        {
          topic: 'Local disk',
          gregale: g.rows.disk,
          them: 'Ephemeral `/tmp` storage per invocation; pair with Vercel Blob for files.',
        },
        {
          topic: 'Regions',
          gregale: g.rows.regions,
          them: 'Global Edge Network CDN with regional function execution.',
        },
      ],
      theyFit: [
        'Your application is Next.js or frontend-centric with global edge caching, ISR and image optimization.',
        'Your team collaborates around Vercel toolbar comments on every frontend PR URL.',
        'All your backend endpoints finish quickly inside serverless function duration limits.',
      ],
      gregaleFits: [
        'You run APIs, background workers, crons, MCP servers or Next.js backends without function timeouts (Vercel Hobby stops at 300s; Pro stops at 800s or 1,800s in beta).',
        'You want bundled managed PostgreSQL with point-in-time restore tied to code rollbacks.',
        'You want per-project monthly pricing without paying $20 a month for every developer or agent seat, plus automatic 5xx canary rollbacks.',
      ],
      migrateDoc: 'migrate-from-vercel',
      migrateLabel: 'Migrate from Vercel',
      articles: [
        'host-nextjs-postgres-outside-vercel',
        'durable-code-workflows-scale-to-zero',
        'scale-to-zero-cron-jobs-event-triggers',
        'add-security-headers-hsts-csp-without-code',
      ],
      faq: [
        {
          question: 'Is Gregale cheaper than Vercel?',
          answer: costAnswer(
            'Vercel Pro charges $20 a month per deploying team seat before overages, while ' +
              'Gregale charges per plan with no per-seat fee for backend services.'
          ),
        },
        {
          question: 'Can I move a Next.js or backend app from Vercel to Gregale?',
          answer:
            'Yes. Next.js apps configured for standalone server output and any Node or Python ' +
            'API deploy with `gregale deploy`, with managed PostgreSQL and background workers in ' +
            'the same project.',
        },
        {
          question: 'Why run a backend on Gregale instead of Vercel functions?',
          answer:
            'Vercel functions cap execution duration (300s on Hobby, 800s standard on Pro) and ' +
            'do not host long-lived worker loops or persistent WebSocket servers. Each Gregale ' +
            'app runs in its own Firecracker microVM alongside background jobs, crons and Postgres.',
        },
        {
          question: 'What happens if a release breaks?',
          answer:
            'On Gregale, a production release first gets 1% of traffic, then 10%, 50% and ' +
            '100%, and only moves up while the new version is answering cleanly. If it starts ' +
            'returning 5xx errors, it rolls back to the previous version on its own. ' +
            'On Vercel, you trigger an instant rollback manually unless you configure Rolling Releases on Pro or Enterprise.',
        },
      ],
      sources: [
        { label: 'Vercel pricing', url: 'https://vercel.com/pricing' },
        { label: 'Vercel Fluid Compute', url: 'https://vercel.com/docs/fluid-compute' },
        {
          label: 'Vercel function limits',
          url: 'https://vercel.com/docs/functions/limitations',
        },
      ],
    },
    {
      slug: 'koyeb',
      competitor: 'Koyeb',
      summary:
        'Gregale vs Koyeb: Firecracker microVMs, scale-to-zero Light Sleep vs ~1s pause billing, ' +
        'managed PostgreSQL, canary rollbacks and pricing compared.',
      rows: [
        {
          topic: 'Free plan',
          gregale: g.rows.free,
          them:
            '1 Free web service (0.1 vCPU, 512 MB RAM, scales to zero after 1h) plus Free ' +
            'Postgres (0.25 vCPU, 1 GB, capped at 50 active compute hours/mo, sleeps after 5m).',
        },
        {
          topic: 'Cheapest paid option',
          gregale: g.rows.paid,
          them:
            'Pay-as-you-go Eco Nano from $1.61 a month (0.1 vCPU, 256 MB) or Eco Micro at ' +
            '$2.68 a month (0.25 vCPU, 512 MB). Koyeb Pro is $29 a month including $10 credit.',
        },
        {
          topic: 'How compute is billed',
          gregale: g.rows.billing,
          them:
            'Billed by the second while instances or serverless Postgres databases run, plus ' +
            'optional team plan fees ($29/mo Pro, $299/mo Scale).',
        },
        {
          topic: 'Idle apps',
          gregale: g.rows.idle,
          them:
            'Scale-to-zero with Light Sleep (wakes rapidly from idle sleep); Free web services ' +
            'sleep after 1 hour idle and Free Postgres sleeps after 5 minutes.',
        },
        {
          topic: 'Releases',
          gregale: g.rows.releases,
          them: 'Immutable versions with health checks; deployments roll back manually.',
        },
        {
          topic: 'Isolation',
          gregale: g.rows.isolation,
          them: 'Firecracker microVMs on bare-metal servers.',
        },
        {
          topic: 'Postgres',
          gregale: g.rows.postgres,
          them:
            'Managed PostgreSQL: Free tier has 50 compute hours/month; paid Small Postgres ' +
            'starts at $29.76 a month (~$0.04/hr for 0.25 vCPU, 1 GB).',
        },
        {
          topic: 'Preview environments',
          gregale: g.rows.previews,
          them: 'Git-driven deployments per branch/service; preview workflows require extra setup.',
        },
        {
          topic: 'Local disk',
          gregale: g.rows.disk,
          them: 'Ephemeral local SSD; persistent NVMe volumes and snapshots available on Koyeb Pro.',
        },
        {
          topic: 'Regions',
          gregale: g.rows.regions,
          them: 'Multiple global regions (including US, Europe and Asia) plus serverless GPU nodes.',
        },
      ],
      theyFit: [
        'You need multi-region edge placement or serverless GPU instances.',
        'You want NVMe persistent volumes on Koyeb Pro ($29/mo).',
        'Your database workload fits Koyeb’s free 50 compute-hour monthly Postgres cap or always-on needs global proximity.',
      ],
      gregaleFits: [
        'You want always-available managed PostgreSQL bundled into a $10 Hobby plan without jumping to $29.76/mo for Postgres.',
        'You want idle apps to pause ~1s after requests instead of sleeping on minute-scale timeouts.',
        'You want automatic 1%→100% canary rollbacks, PR preview environments on Free, and scoped AI agent guardrails.',
      ],
      migrateDoc: 'migrate-from-koyeb',
      migrateLabel: 'Migrate from Koyeb',
      articles: [
        'what-breaks-when-app-scales-to-zero',
        'durable-inbound-webhooks-scale-to-zero',
        'host-python-fastmcp-server',
        'shadow-test-release-traffic-mirroring',
      ],
      faq: [
        {
          question: 'Is Gregale cheaper than Koyeb?',
          answer: costAnswer(
            'Koyeb’s Eco Micro (512 MB) is $2.68 a month on compute alone, though paid Koyeb ' +
              'Managed Postgres starts at $29.76 a month compared with Gregale Hobby at $10 a month ' +
              'including 1 managed Postgres database.'
          ),
        },
        {
          question: 'Do both Gregale and Koyeb use Firecracker?',
          answer:
            'Yes. Both isolate instances in Firecracker microVMs. Koyeb offers multiple regions ' +
            'and GPU instances; Gregale focuses on one-command backends, ~1s pause billing, ' +
            'bundled Postgres and automatic canary rollbacks.',
        },
        {
          question: 'Can I move a Koyeb app to Gregale?',
          answer:
            'Yes. Standard Dockerfiles and Git-built Node, Python or Go apps listening on PORT ' +
            'deploy via `gregale deploy` with environment variables and `DATABASE_URL` preserved.',
        },
        {
          question: 'What happens if a release breaks?',
          answer:
            'On Gregale, a production release first gets 1% of traffic, then 10%, 50% and ' +
            '100%, and rolls back on its own if 5xx errors spike. On Koyeb, you manually ' +
            'trigger a rollback to an earlier immutable deployment version.',
        },
      ],
      sources: [
        { label: 'Koyeb pricing', url: 'https://www.koyeb.com/pricing' },
        {
          label: 'Koyeb scale-to-zero',
          url: 'https://www.koyeb.com/docs/run-and-scale/scale-to-zero',
        },
        { label: 'Koyeb managed Postgres', url: 'https://www.koyeb.com/docs/databases' },
      ],
    },
    {
      slug: 'northflank',
      competitor: 'Northflank',
      summary:
        'Gregale vs Northflank: container PaaS and BYOC vs single-command Firecracker microVMs, ' +
        'idle billing, canary rollbacks and pricing compared.',
      rows: [
        {
          topic: 'Free plan',
          gregale: g.rows.free,
          them:
            'Northflank Free Sandbox: 2 services, 2 cron jobs and 1 database addon on Northflank ' +
            'Cloud (always on, no sleeping; up to 1 BYOC cluster with 12 vCPU / 48 GB).',
        },
        {
          topic: 'Cheapest paid option',
          gregale: g.rows.paid,
          them:
            'Usage-based plans billed per second at $0.01667 per vCPU-hour (~$12/vCPU-mo) and ' +
            '$0.00833 per GB-hour (~$6/GB-mo); a 0.5 vCPU / 1 GB service is ~$12 a month.',
        },
        {
          topic: 'How compute is billed',
          gregale: g.rows.billing,
          them:
            'CPU and memory billed separately by the second while containers run, plus $0.15/GB-mo ' +
            'persistent storage and $0.06/GB egress. No per-seat workspace fees.',
        },
        {
          topic: 'Idle apps',
          gregale: g.rows.idle,
          them:
            'Sandbox services are always on; paid containers bill continuously while active ' +
            'unless scaled down via autoscaling rules.',
        },
        {
          topic: 'Releases',
          gregale: g.rows.releases,
          them:
            'Supports rolling updates, blue-green deploys and configurable canary traffic splitting; ' +
            'not automatic 1%→100% 5xx rollback by default on every deploy.',
        },
        {
          topic: 'Isolation',
          gregale: g.rows.isolation,
          them: 'Isolated container runtimes (gVisor / Cloud Hypervisor microVMs) across managed K8s.',
        },
        {
          topic: 'Postgres',
          gregale: g.rows.postgres,
          them:
            'Managed PostgreSQL, MySQL, MongoDB, Redis and RabbitMQ addons billed by vCPU/RAM ' +
            'hours plus $0.15/GB-mo disk.',
        },
        {
          topic: 'Preview environments',
          gregale: g.rows.previews,
          them: 'Automated preview environments per pull request supported via templates and CI.',
        },
        {
          topic: 'Local disk',
          gregale: g.rows.disk,
          them: 'Persistent SSD/HDD volumes attached to services or databases ($0.15/GB-month).',
        },
        {
          topic: 'Regions',
          gregale: g.rows.regions,
          them: 'Northflank Cloud regions plus BYOC inside AWS, GCP, Azure or Oracle.',
        },
      ],
      theyFit: [
        'You need Bring-Your-Own-Cloud (BYOC) inside your own AWS EKS, GCP GKE or Azure AKS account.',
        'You want an always-on Free Sandbox with a database or GPU/Kubernetes pipeline primitives.',
        'You need enterprise RBAC across large multi-cluster microservice topologies.',
      ],
      gregaleFits: [
        'You want intermittent or spaced API traffic to stop billing ~1s after every request instead of paying 24/7 vCPU+RAM rates.',
        'You want a simpler CLI without Kubernetes concepts, plus automatic 1%→100% 5xx canary rollbacks and code+Postgres PITR rollback.',
        'You want scoped `--agent` keys, human approval links, cost previews and undo for AI coding agents.',
      ],
      migrateDoc: 'migrate-from-northflank',
      migrateLabel: 'Migrate from Northflank',
      articles: [
        'sidecar-companions-without-kubernetes',
        'atomic-multi-service-releases',
        'promote-staging-to-production-without-rebuilding',
        'test-migration-postgres-branch-ttl',
      ],
      faq: [
        {
          question: 'Is Gregale cheaper than Northflank?',
          answer: costAnswer(
            'Northflank bills ~$12 a month for a 0.5 vCPU / 1 GB always-on container plus ' +
              'database compute and disk storage, while Northflank’s Free Sandbox covers 2 always-on services and 1 DB.'
          ),
        },
        {
          question: 'Does Gregale support Bring-Your-Own-Cloud (BYOC) like Northflank?',
          answer:
            'No. Gregale is a fully managed single-control-plane platform running each app in a ' +
            'Firecracker microVM. Choose Northflank if running inside your own AWS, GCP or Azure ' +
            'cluster is a hard requirement.',
        },
        {
          question: 'Can I move a containerized service from Northflank to Gregale?',
          answer:
            'Yes. Any standard Dockerfile or Node/Python/Go service deploys via `gregale deploy`, ' +
            'with managed PostgreSQL bound as `DATABASE_URL`.',
        },
        {
          question: 'What happens if a release breaks?',
          answer:
            'On Gregale, a production release first gets 1% of traffic, then 10%, 50% and ' +
            '100%, and rolls back on its own if 5xx errors rise. On Northflank, you configure ' +
            'custom pipeline rules or trigger rollbacks across revisions.',
        },
      ],
      sources: [
        { label: 'Northflank pricing', url: 'https://northflank.com/pricing' },
        {
          label: 'Northflank platform overview',
          url: 'https://northflank.com/docs/v1/application/getting-started/what-is-northflank',
        },
      ],
    },
    {
      slug: 'coolify',
      competitor: 'Coolify',
      summary:
        'Gregale vs Coolify: self-hosted VPS control plane vs managed Firecracker microVMs, idle pause billing, pre-wake WAF and canary rollbacks compared.',
      rows: [
        {
          topic: 'Free plan',
          gregale: g.rows.free,
          them: 'Self-hosted Coolify is $0 open-source software; you still pay for your own VPS (Hetzner, DigitalOcean, AWS).',
        },
        {
          topic: 'Cheapest paid option',
          gregale: g.rows.paid,
          them: 'Coolify Cloud starts at $5 a month for up to 2 servers (+$3 per extra server), plus your underlying VPS cost.',
        },
        {
          topic: 'How compute is billed',
          gregale: g.rows.billing,
          them: 'Fixed monthly server bill on your VPS provider, regardless of whether an app serves traffic or sits idle.',
        },
        {
          topic: 'Idle apps',
          gregale: g.rows.idle,
          them: 'Always running on your VPS; there is no automatic per-second snapshot pause across individual apps.',
        },
        {
          topic: 'Releases',
          gregale: g.rows.releases,
          them: 'Supports rolling deployments on your connected server rather than default 1%→100% 5xx canary rollbacks or DB-synced restores.',
        },
        {
          topic: 'Isolation',
          gregale: g.rows.isolation,
          them: 'Docker containers sharing the OS kernel of the VPS you provision and patch.',
        },
        {
          topic: 'Postgres',
          gregale: g.rows.postgres,
          them: 'Self-managed database containers running on your own VPS with scheduled backups to S3 you configure and monitor.',
        },
        {
          topic: 'Preview environments',
          gregale: g.rows.previews,
          them: 'PR preview deployments supported on your server hardware, bounded by your VPS RAM and disk.',
        },
        {
          topic: 'Local disk',
          gregale: g.rows.disk,
          them: 'Persistent Docker volumes directly on the VPS host disk.',
        },
        {
          topic: 'Regions',
          gregale: g.rows.regions,
          them: 'Anywhere you connect a Linux server (Hetzner, DigitalOcean, Vultr, AWS, bare metal).',
        },
      ],
      theyFit: [
        'You want maximum raw RAM/CPU per dollar on a fixed $5–$20 Hetzner or DigitalOcean VPS for steady 24/7 workloads.',
        'You want 360+ self-hosted one-click apps or durable local Docker volumes on hardware you control.',
        'You are comfortable patching Linux hosts, tuning Traefik, and owning OS security and backup recovery.',
      ],
      gregaleFits: [
        'You want VPS-like low idle cost without 3 AM server maintenance, OS patching, backup verification, or Traefik tuning.',
        'You want Firecracker microVM isolation, pre-wake OWASP WAF + browser challenges, and default hard monthly spend caps.',
        'You want automatic 1%→100% canary rollbacks, code + PostgreSQL PITR rollbacks, and scoped `--agent` guardrails.',
      ],
      migrateDoc: 'container-compatibility',
      migrateLabel: 'Container compatibility',
      articles: [
        'backend-without-devops',
        'password-protect-app-basic-auth-ip-allowlist',
        'block-insecure-deploys-security-policy',
        'debug-production-5xx-crash-snapshots-and-profile-diffs',
      ],
      faq: [
        {
          question: 'Is Gregale cheaper than Coolify on a VPS?',
          answer: costAnswer(
            'Coolify software is free self-hosted (or $5/mo for Coolify Cloud across 2 servers) on top of a fixed VPS bill you pay whether apps are busy or idle.'
          ),
        },
        {
          question: 'Why switch from Coolify on a VPS to Gregale?',
          answer:
            'Teams move when they want scale-to-zero billing, Firecracker isolation, pre-wake OWASP WAF, default hard spend caps, and automatic rollbacks without operating their own Linux servers.',
        },
        {
          question: 'What happens if a release breaks?',
          answer:
            'On Gregale, a production release first gets 1% of traffic, then 10%, 50% and 100%, and rolls back on its own if 5xx errors rise. On Coolify, you redeploy an earlier commit or image manually on your server.',
        },
      ],
      sources: [
        { label: 'Coolify pricing', url: 'https://coolify.io/pricing' },
        { label: 'Coolify documentation', url: 'https://coolify.io/docs' },
      ],
    },
    {
      slug: 'cloudflare-workers',
      competitor: 'Cloudflare Workers',
      summary:
        'Gregale vs Cloudflare Workers: V8 isolates & Cloudflare Containers vs Firecracker microVMs, full CPython/Docker support, bundled Postgres and canary rollbacks compared.',
      rows: [
        {
          topic: 'Free plan',
          gregale: g.rows.free,
          them: 'Workers Free: $0 a month for 100,000 requests/day with 10 ms CPU time per invocation (no Containers on Free).',
        },
        {
          topic: 'Cheapest paid option',
          gregale: g.rows.paid,
          them: 'Workers Paid: $5 a month minimum with 10M requests and 30M CPU ms included ($0.30/M extra requests, $0.02/M extra CPU ms); Containers bill extra CPU, RAM and disk.',
        },
        {
          topic: 'How compute is billed',
          gregale: g.rows.billing,
          them: 'Workers bill active CPU ms and requests (zero egress fees); Containers bill active CPU, allocated RAM and disk per 10 ms past included allowances.',
        },
        {
          topic: 'Idle apps',
          gregale: g.rows.idle,
          them: 'Workers isolates consume nothing when idle; Containers also scale to zero when inactive.',
        },
        {
          topic: 'Releases',
          gregale: g.rows.releases,
          them: 'Gradual deployments let you split percentages manually between two Worker versions; not default automatic 1%→100% 5xx rollback across Docker/Postgres.',
        },
        {
          topic: 'Isolation',
          gregale: g.rows.isolation,
          them: 'V8 isolates on Workers (128 MB memory limit) and isolated Linux containers on Cloudflare Containers.',
        },
        {
          topic: 'Postgres',
          gregale: g.rows.postgres,
          them: 'Cloudflare D1 (SQLite) natively, or external PostgreSQL over Hyperdrive connection pooling.',
        },
        {
          topic: 'Preview environments',
          gregale: g.rows.previews,
          them: 'Preview URLs generated automatically for uploaded Worker versions.',
        },
        {
          topic: 'Local disk',
          gregale: g.rows.disk,
          them: 'R2 object storage, KV and Durable Objects on Workers; ephemeral container disk on Containers.',
        },
        {
          topic: 'Regions',
          gregale: g.rows.regions,
          them: 'Global Anycast network across 300+ Cloudflare edge locations.',
        },
      ],
      theyFit: [
        'You need ultra-low-latency global edge execution across 300+ PoPs with zero egress fees.',
        'Your backend is lightweight JavaScript/TypeScript built around D1, KV, R2, or Durable Objects.',
        'You run pure edge routing, auth middleware, or streaming Workers where V8 isolates excel.',
      ],
      gregaleFits: [
        'You run FastAPI, FastMCP, Django, Express, or Go with standard C/native libraries and Linux Dockerfiles without V8 or Pyodide 128 MB isolate limits.',
        'You want bundled managed PostgreSQL with code + DB point-in-time rollbacks (`--restore-databases`).',
        'You want automatic 1%→100% 5xx canary rollbacks, managed scale-to-zero WebSockets, and scoped `--agent` guardrails.',
      ],
      migrateDoc: 'container-compatibility',
      migrateLabel: 'Container compatibility',
      articles: [
        'mcp-server-hosting',
        'host-django-postgres-migrations-rollback',
        'delayed-tasks-without-redis-scale-to-zero',
        'private-microservice-networking-no-vpc',
      ],
      faq: [
        {
          question: 'Is Gregale cheaper than Cloudflare Workers?',
          answer: costAnswer(
            'Cloudflare Workers Free covers 100,000 requests/day inside 10 ms CPU isolates and Workers Paid starts at $5/mo with zero egress fees, while Cloudflare Containers bill separate CPU, RAM and disk rates.'
          ),
        },
        {
          question:
            'Why run Python FastAPI or MCP servers on Gregale instead of Cloudflare Workers?',
          answer:
            'Cloudflare Python Workers execute inside WebAssembly/Pyodide isolates capped at 128 MB memory, whereas Gregale runs full CPython 3.13 or standard Linux Dockerfiles in isolated Firecracker microVMs.',
        },
        {
          question: 'What happens if a release breaks?',
          answer:
            'On Gregale, a production release first gets 1% of traffic, then 10%, 50% and 100%, and rolls back on its own if 5xx errors rise. On Cloudflare Workers, you adjust gradual deployment weights or roll back versions manually.',
        },
      ],
      sources: [
        {
          label: 'Cloudflare Workers pricing',
          url: 'https://developers.cloudflare.com/workers/platform/pricing/',
        },
        {
          label: 'Cloudflare Workers limits',
          url: 'https://developers.cloudflare.com/workers/platform/limits/',
        },
        {
          label: 'Cloudflare Containers pricing',
          url: 'https://developers.cloudflare.com/containers/pricing/',
        },
      ],
    },
    {
      slug: 'aws',
      competitor: 'AWS App Runner',
      summary:
        'Gregale vs AWS App Runner: provisioned container memory fees vs ~1s idle pause, bundled Postgres, PR previews and automatic canary rollbacks compared.',
      rows: [
        {
          topic: 'Free plan',
          gregale: g.rows.free,
          them: 'No permanent free tier on AWS App Runner (new accounts can use time-limited AWS Free Tier credits).',
        },
        {
          topic: 'Cheapest paid option',
          gregale: g.rows.paid,
          them: 'Minimum instance is 0.25 vCPU / 0.5 GB: provisioned memory bills continuously at ~$0.007/GB-hour (US/EU) plus ~$0.064/vCPU-hour while handling requests, optional source build-minute fees and automated deployment fees.',
        },
        {
          topic: 'How compute is billed',
          gregale: g.rows.billing,
          them: 'Per second (1-minute minimum) for active vCPU (~$0.064/vCPU-hour) plus continuous provisioned memory (~$0.007/GB-hour) while unpaused, plus AWS data transfer and source build minutes.',
        },
        {
          topic: 'Idle apps',
          gregale: g.rows.idle,
          them: 'Keeps at least 1 warm provisioned instance billed for memory (~$0.007/GB-hour) unless manually or programmatically paused; paused services stop traffic until resumed.',
        },
        {
          topic: 'Releases',
          gregale: g.rows.releases,
          them: 'Automatic rollback on failed health checks during deploy, without default 1%→10%→50%→100% live-traffic 5xx canary rollback or coordinated database restore.',
        },
        {
          topic: 'Isolation',
          gregale: g.rows.isolation,
          them: 'Isolated AWS managed container runtime powered by AWS Firecracker.',
        },
        {
          topic: 'Postgres',
          gregale: g.rows.postgres,
          them: 'Separate Amazon RDS or Aurora PostgreSQL provisioned and wired via VPC connectors, IAM and Secrets Manager.',
        },
        {
          topic: 'Preview environments',
          gregale: g.rows.previews,
          them: 'Not built in automatically per pull request; requires separate App Runner services and CI wiring.',
        },
        {
          topic: 'Local disk',
          gregale: g.rows.disk,
          them: 'Ephemeral instance storage (cleared on pause or restart); persistent data lives in Amazon RDS or Amazon S3.',
        },
        {
          topic: 'Regions',
          gregale: g.rows.regions,
          them: 'Selected AWS regions globally, directly inside your AWS account VPC.',
        },
      ],
      theyFit: [
        'Your team already runs inside AWS IAM, VPC security groups, PrivateLink, and Amazon RDS/Aurora.',
        'You need multi-region AWS placement or direct private access to internal AWS services.',
        'You want managed container deployments billed on your consolidated AWS enterprise agreement.',
      ],
      gregaleFits: [
        'You want a real backend API, worker and managed PostgreSQL up in one command without wiring RDS, VPC connectors, IAM and Secrets Manager.',
        'You want idle apps to pause automatically ~1s after requests instead of paying continuous provisioned memory or manually pausing services.',
        'You want PR preview environments, automatic 1%→100% 5xx canary rollbacks, code+DB PITR rollback and hard monthly spend caps.',
      ],
      migrateDoc: 'container-compatibility',
      migrateLabel: 'Container compatibility',
      articles: [
        'run-code-on-file-upload-bucket-trigger',
        'private-object-storage-without-s3-iam',
        'pull-queue-workers-workload-identity',
        'stop-bot-traffic-cloud-bill-shock',
      ],
      faq: [
        {
          question: 'Is Gregale cheaper than AWS App Runner?',
          answer: costAnswer(
            'AWS App Runner bills ~$0.007 per GB-hour continuously for unpaused provisioned memory (US/EU), ~$0.064 per vCPU-hour while serving requests, plus separate RDS PostgreSQL, build-minute and AWS egress fees.'
          ),
        },
        {
          question: 'Does Gregale require configuring AWS VPC connectors for PostgreSQL?',
          answer:
            'No. On Gregale Hobby and above, managed PostgreSQL is provisioned alongside your app and bound automatically as DATABASE_URL without VPC connectors or security group rules.',
        },
        {
          question: 'What happens if a release breaks?',
          answer:
            'On Gregale, a production release first gets 1% of traffic, then 10%, 50% and 100%, and rolls back on its own if 5xx errors rise. On AWS App Runner, deploys roll back if startup health checks fail, rather than stepping live traffic automatically.',
        },
      ],
      sources: [
        { label: 'AWS App Runner pricing', url: 'https://aws.amazon.com/apprunner/pricing/' },
        {
          label: 'AWS App Runner auto scaling',
          url: 'https://docs.aws.amazon.com/apprunner/latest/dg/manage-autoscaling.html',
        },
        {
          label: 'AWS App Runner pause and resume',
          url: 'https://docs.aws.amazon.com/apprunner/latest/dg/manage-pause-resume.html',
        },
      ],
    },
    {
      slug: 'digitalocean',
      competitor: 'DigitalOcean App Platform',
      summary:
        'Gregale vs DigitalOcean App Platform: always-on container rates and separate managed Postgres vs ~1s idle pause, PR previews and automatic canary rollbacks compared.',
      rows: [
        {
          topic: 'Free plan',
          gregale: g.rows.free,
          them: 'Up to 3 static sites ($0 a month, 1 GiB transfer/app); no free tier for backend services or containers.',
        },
        {
          topic: 'Cheapest paid option',
          gregale: g.rows.paid,
          them: 'Shared CPU container starts at $5 a month (1 shared vCPU, 512 MiB RAM, 50 GiB transfer); dedicated CPU starts at $29 a month (1 dedicated vCPU, 512 MiB RAM).',
        },
        {
          topic: 'How compute is billed',
          gregale: g.rows.billing,
          them: 'Fixed monthly tier per container component, prorated by the second (1-minute minimum) while deployed, plus $0.10/GiB overage transfer.',
        },
        {
          topic: 'Idle apps',
          gregale: g.rows.idle,
          them: 'Services and workers bill continuously at their monthly rate even when idle; only one-off or scheduled jobs stop billing between runs.',
        },
        {
          topic: 'Releases',
          gregale: g.rows.releases,
          them: 'Rolling deployments with health checks and manual rollback to prior releases; no default 1%→10%→50%→100% automated 5xx canary rollback.',
        },
        {
          topic: 'Isolation',
          gregale: g.rows.isolation,
          them: 'Managed Kubernetes containers inside DigitalOcean infrastructure.',
        },
        {
          topic: 'Postgres',
          gregale: g.rows.postgres,
          them: 'Separate DigitalOcean Managed PostgreSQL starting at $15 a month for single-node (1 GiB RAM) or $30 a month HA, plus development DB attachments.',
        },
        {
          topic: 'Preview environments',
          gregale: g.rows.previews,
          them: 'Deploy previews configurable for App Platform pull requests against fixed/prorated component tiers.',
        },
        {
          topic: 'Local disk',
          gregale: g.rows.disk,
          them: 'Ephemeral container filesystem; external object storage via DigitalOcean Spaces.',
        },
        {
          topic: 'Regions',
          gregale: g.rows.regions,
          them: 'Multiple DigitalOcean datacenter regions (North America, Europe and Asia).',
        },
      ],
      theyFit: [
        'You already run Droplets, Spaces, or Managed Databases in a DigitalOcean VPC.',
        'Your backend handles steady 24/7 traffic and prefers flat $5/$12/$25/mo shared-CPU tiers.',
        'You want multi-datacenter choice across North America, Europe and Asia.',
      ],
      gregaleFits: [
        'You run intermittent APIs, staging services or MCP servers that sit idle most of the day and want compute billing to pause ~1s after requests.',
        'You want bundled managed PostgreSQL with coordinated code + DB PITR rollback inside the $10 Hobby plan instead of $15/mo+ add-on clusters.',
        'You want automatic 1%→100% 5xx canary rollbacks, hard monthly spend caps and scoped AI agent guardrails.',
      ],
      migrateDoc: 'migrate-from-digitalocean',
      migrateLabel: 'Migrate from DigitalOcean App Platform',
      articles: [
        'host-bun-hono-postgres-api',
        'batch-jobs-fan-out-retry-failed-inputs',
        'zero-restart-secret-rotation',
        'telegram-bot-webhook-scale-to-zero',
      ],
      faq: [
        {
          question: 'Is Gregale cheaper than DigitalOcean App Platform?',
          answer: costAnswer(
            'DigitalOcean App Platform bills $5 a month for a 512 MiB shared-CPU container always on, plus $15 a month for single-node Managed PostgreSQL (or $30/mo HA).'
          ),
        },
        {
          question: 'Does Gregale offer a backend free tier unlike DigitalOcean App Platform?',
          answer:
            'Yes. DigitalOcean App Platform free covers static sites only, whereas Gregale Free runs full containerized APIs and MCP servers in Firecracker microVMs at $0 up to 20 GB-RAM-hours a month.',
        },
        {
          question: 'What happens if a release breaks?',
          answer:
            'On Gregale, a production release first gets 1% of traffic, then 10%, 50% and 100%, and rolls back on its own if 5xx errors rise. On DigitalOcean App Platform, you manually roll back to a previous deployment if a regression slips past health checks.',
        },
      ],
      sources: [
        {
          label: 'DigitalOcean App Platform pricing',
          url: 'https://docs.digitalocean.com/products/app-platform/details/pricing/',
        },
        {
          label: 'DigitalOcean Managed PostgreSQL pricing',
          url: 'https://docs.digitalocean.com/products/databases/postgresql/details/pricing/',
        },
      ],
    },
    {
      slug: 'replit',
      competitor: 'Replit',
      summary:
        'Gregale vs Replit: moving production APIs and AI-built backends off browser workspaces onto Git-native Firecracker microVMs with canary rollbacks and spend caps.',
      rows: [
        {
          topic: 'Free plan',
          gregale: g.rows.free,
          them: 'Replit Starter is free for browser development workspaces; live production deployments and production databases require paid usage or Replit Core.',
        },
        {
          topic: 'Cheapest paid option',
          gregale: g.rows.paid,
          them: 'Replit Core is $20 a month ($18/mo annual) including $20/mo in non-rolling credits; Autoscale bills $1/mo base + $0.60/M compute units + $0.40/M requests; Reserved VMs start at $0.0208/hr (~$15/mo for 0.5 vCPU / 2 GiB RAM).',
        },
        {
          topic: 'How compute is billed',
          gregale: g.rows.billing,
          them: 'Consumes included Core credits first, then pay-as-you-go for Autoscale compute units & requests, always-on Reserved VM hours, and production Postgres compute/storage.',
        },
        {
          topic: 'Idle apps',
          gregale: g.rows.idle,
          them: 'Autoscale Deployments scale down after ~15 minutes idle (keeping the $1/mo base fee); Reserved VMs run and bill continuously.',
        },
        {
          topic: 'Releases',
          gregale: g.rows.releases,
          them: 'One-click republish from the workspace with manual rollback; no Git PR preview environments or default 1%→100% 5xx canary rollback.',
        },
        {
          topic: 'Isolation',
          gregale: g.rows.isolation,
          them: 'Cloud containers on Autoscale or dedicated GCP VMs on Reserved VM deployments.',
        },
        {
          topic: 'Postgres',
          gregale: g.rows.postgres,
          them: 'Built-in workspace PostgreSQL (free in dev; production PostgreSQL bills $0.16 per compute hour + $0.35/GiB-month, up to 100 GiB).',
        },
        {
          topic: 'Preview environments',
          gregale: g.rows.previews,
          them: 'Live dev preview inside the Replit browser workspace rather than isolated per-PR preview URLs.',
        },
        {
          topic: 'Local disk',
          gregale: g.rows.disk,
          them: 'Replit Object Storage for deployed apps; Reserved VM filesystem resets across redeployments.',
        },
        {
          topic: 'Regions',
          gregale: g.rows.regions,
          them: 'Google Cloud regions managed by Replit.',
        },
      ],
      theyFit: [
        'You want an all-in-one browser IDE and AI app generator where beginners prototype without Git or a local terminal.',
        'You want workspace snapshots and zero local tooling setup while iterating on early demos.',
        'Your team prefers per-seat Replit Core credits bundling editor AI and hosting.',
      ],
      gregaleFits: [
        'You pushed an AI-built app from Replit, Cursor, or Claude Code to GitHub and want clean Git-owned production hosting outside a browser IDE.',
        'You want PR preview environments, automatic 1%→100% 5xx canary rollbacks, code + PostgreSQL PITR rollback and strict monthly spend caps.',
        'You want scoped `--agent` keys with approval links so coding agents can deploy safely to real infrastructure.',
      ],
      migrateDoc: 'migrate-from-replit',
      migrateLabel: 'Migrate from Replit',
      articles: [
        'deploy-vibe-coded-app-to-production',
        'best-cloud-for-ai-coding-agents',
        'ai-agent-production-approval',
        'undo-ai-agent-changes',
      ],
      faq: [
        {
          question: 'Is Gregale cheaper than Replit Deployments?',
          answer: costAnswer(
            'Replit Core costs $20 a month ($18/mo annual with $20 included credits), Autoscale adds $1/mo base plus compute-unit and request metering, Reserved VMs start around $15 a month always-on, and production Postgres bills $0.16 per active compute hour.'
          ),
        },
        {
          question: 'Can I move an app built on Replit to Gregale?',
          answer:
            'Yes. Push your Replit project to GitHub and open /deploy?repo=https://github.com/owner/repo or run `gregale deploy` locally; Node, Bun, Python and Go apps deploy with bundled managed PostgreSQL.',
        },
        {
          question: 'What happens if a release breaks?',
          answer:
            'On Gregale, a production release first gets 1% of traffic, then 10%, 50% and 100%, and rolls back on its own if 5xx errors rise, with optional database point-in-time restore. On Replit, you republish or manually revert to an earlier deployment.',
        },
      ],
      sources: [
        { label: 'Replit pricing', url: 'https://replit.com/pricing' },
        {
          label: 'Replit deployments overview',
          url: 'https://docs.replit.com/cloud-services/deployments/about-deployments',
        },
        {
          label: 'Replit Autoscale pricing',
          url: 'https://docs.replit.com/cloud-services/deployments/autoscale-deployments',
        },
        {
          label: 'Replit Reserved VM deployments',
          url: 'https://docs.replit.com/cloud-services/deployments/reserved-vm-deployments',
        },
        {
          label: 'Replit SQL Database',
          url: 'https://docs.replit.com/cloud-services/storage-and-databases/sql-database',
        },
      ],
    },
  ];
}

/** Slugs, for the route list. Must match `comparisons()`. */
export const COMPARISON_SLUGS = [
  'heroku',
  'render',
  'railway',
  'fly',
  'cloud-run',
  'vercel',
  'koyeb',
  'northflank',
  'coolify',
  'cloudflare-workers',
  'aws',
  'digitalocean',
  'replit',
] as const;
