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
export const COMPARISONS_CHECKED = '2026-11-24';

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
        `${free.name}: ${usd(free.monthly)}, ${apps(free.deployedApps)} with ${free.ramMb} MB and ` +
        `${free.includedGbHours} GB-RAM-hours a month. It stops at the allowance rather than billing you.`,
      paid:
        `${hobby.name}: ${usd(hobby.monthly)} a month for ${apps(hobby.deployedApps)} with ` +
        `${hobby.ramMb} MB each and ${hobby.includedGbHours} GB-RAM-hours included.`,
      billing:
        `By memory and time (GB-RAM-hours), CPU included. Beyond the plan's allowance, ` +
        `${usd(catalog.overagePerGbHour)} per GB-RAM-hour, up to a spend cap you set.`,
      idle:
        'Every app parks when idle, on every plan, and wakes from a snapshot on the next ' +
        'request. Set min_instances to keep one warm.',
      isolation: 'A Firecracker microVM per instance.',
      postgres: `Managed PostgreSQL on ${hobby.name} and above, bound to the app as DATABASE_URL.`,
      previews: 'A preview environment per open pull request, on every plan including Free.',
      disk: 'No durable local disk. Keep state in managed PostgreSQL or object storage.',
      regions: 'One region today.',
    },
  };
}

export function comparisons(catalog: Catalog): Comparison[] {
  const g = gregaleFacts(catalog);
  const costAnswer = (them: string) =>
    `It depends on how much of the day your app is busy. Gregale bills memory only while an ` +
    `app is awake. A ${g.hobbyRam} app that is busy about eight hours a day uses around ` +
    `${g.partTimeGbHours} GB-RAM-hours a month, which ` +
    (g.partTimeFits
      ? `fits inside ${g.hobby.name}'s ${g.usd(g.hobby.monthly)} plan. `
      : `goes beyond ${g.hobby.name}'s allowance. `) +
    `The same app awake all month costs about ${g.alwaysOn} on Gregale, and ${them}`;

  return [
    {
      slug: 'heroku',
      competitor: 'Heroku',
      summary:
        'Gregale vs Heroku: pricing, idle apps, databases and preview environments compared, ' +
        'and how to move a Heroku app without code changes.',
      rows: [
        {
          topic: 'Free plan',
          gregale: g.rows.free,
          them: 'No free plan. Eco dynos are $5 a month and sleep after 30 minutes idle.',
        },
        {
          topic: 'Cheapest paid option',
          gregale: g.rows.paid,
          them: 'Basic dyno: $7 a month, 0.5 GB, always on. Eco is cheaper but personal accounts only.',
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
        'You want a free plan to start, or apps that cost nothing while nobody is using them.',
        'You run several small APIs or services that are idle much of the day.',
        'You want a preview environment for every pull request without extra setup.',
      ],
      migrateDoc: 'migrate-from-heroku',
      migrateLabel: 'Migrate from Heroku',
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
      ],
      sources: [{ label: 'Heroku pricing', url: 'https://www.heroku.com/pricing/' }],
    },
    {
      slug: 'render',
      competitor: 'Render',
      summary:
        'Gregale vs Render: free tier spin-down, instance pricing, idle apps and databases ' +
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
          them: 'Starter instance: $7 a month, 512 MB and 0.5 CPU, always on.',
        },
        {
          topic: 'How compute is billed',
          gregale: g.rows.billing,
          them: 'A workspace plan (Hobby $0, Pro $25 a month) plus a monthly price per instance.',
        },
        {
          topic: 'Idle apps',
          gregale: g.rows.idle,
          them: 'Only Free web services spin down. Paid instances run all the time.',
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
          them: 'Persistent disks on paid services, $0.25 per GB a month.',
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
        'You want paid apps to park when idle too, not only free ones.',
        'You want an idle app to wake from a snapshot instead of starting a fresh process.',
        'You run several small APIs and want them on one plan with a spend cap.',
      ],
      migrateDoc: 'migrate-from-render',
      migrateLabel: 'Migrate from Render',
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
            'Yes, but on every plan, not only Free, and an app wakes from a snapshot of its ' +
            'running state instead of starting from scratch.',
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
        'Gregale vs Railway: plans, usage-based pricing, sleeping services and databases ' +
        'compared, and how to move a Railway service to Gregale.',
      rows: [
        {
          topic: 'Free plan',
          gregale: g.rows.free,
          them:
            '$0 with $1 of usage a month. Services sleep after 5 to 10 minutes without outbound ' +
            'traffic. Up to 1 vCPU and 0.5 GB per service.',
        },
        {
          topic: 'Cheapest paid option',
          gregale: g.rows.paid,
          them: 'Hobby: $5 a month, which includes $5 of usage.',
        },
        {
          topic: 'How compute is billed',
          gregale: g.rows.billing,
          them: 'Usage by the second: memory $10 per GB a month, CPU $20 per vCPU a month, egress $0.05 per GB.',
        },
        {
          topic: 'Idle apps',
          gregale: g.rows.idle,
          them: 'Free services sleep when idle. On paid plans, compute is always on.',
        },
        {
          topic: 'Databases',
          gregale: g.rows.postgres,
          them: 'One-click Postgres, Redis, MySQL and MongoDB.',
        },
        {
          topic: 'Local disk',
          gregale: g.rows.disk,
          them: 'Volumes, $0.15 per GB a month.',
        },
      ],
      theyFit: [
        'Your app runs all day: Railway charges less per GB of memory for a process that never stops.',
        'You want Redis, MySQL or MongoDB alongside Postgres in one click.',
        'You need a volume for files that survive restarts.',
      ],
      gregaleFits: [
        'Your apps are idle much of the day, and you only want to pay while they serve.',
        'You want CPU included in the memory price instead of metered separately.',
        'You want a monthly allowance with a hard spend cap instead of open-ended usage.',
      ],
      migrateDoc: 'deploy-from-github',
      migrateLabel: 'Deploy from GitHub',
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
            'Yes. Gregale builds Node, Python and Go from source, or uses your Dockerfile, and ' +
            'takes configuration as environment variables and secrets. Connect the GitHub ' +
            'repository and deploy, then move the database.',
        },
        {
          question: 'Do Gregale apps sleep like Railway free services?',
          answer:
            'Yes, on every plan: an idle app parks and wakes from a snapshot on the next request. ' +
            'Use min_instances to keep an app warm.',
        },
      ],
      sources: [
        { label: 'Railway pricing', url: 'https://railway.com/pricing' },
        { label: 'Railway plans', url: 'https://docs.railway.com/reference/pricing/plans' },
      ],
    },
    {
      slug: 'fly',
      competitor: 'Fly.io',
      summary:
        'Gregale vs Fly.io: free plan, Machine pricing, auto-stop and Postgres compared, and ' +
        'what moving an app to Gregale involves.',
      rows: [
        {
          topic: 'Free plan',
          gregale: g.rows.free,
          them: 'Free plan: $5 of usage every month, up to 3 Machines.',
        },
        {
          topic: 'Cheapest paid option',
          gregale: g.rows.paid,
          them:
            'Pay As You Go, no monthly fee. A shared-cpu-1x Machine is $2.19 a month with 256 MB ' +
            'or $6.70 with 1 GB.',
        },
        {
          topic: 'How compute is billed',
          gregale: g.rows.billing,
          them:
            'By the second while a Machine runs. A stopped Machine bills only its root ' +
            'filesystem, $0.15 per GB a month.',
        },
        {
          topic: 'Idle apps',
          gregale: g.rows.idle,
          them: 'Machines can stop or suspend when idle and start again on the next request.',
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
          them: 'Volumes, $0.15 per GB a month.',
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
        'You want to deploy from source without writing infrastructure configuration.',
        'You want preview environments, crons and background services built in.',
        'You want a monthly allowance with a hard spend cap.',
      ],
      migrateDoc: 'container-compatibility',
      migrateLabel: 'Container compatibility',
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
            'Usually. If your app builds from a Dockerfile, Gregale can run that image. Apps that ' +
            'rely on a volume need their files moved to managed PostgreSQL or object storage, ' +
            'because Gregale instances have no durable local disk.',
        },
        {
          question: 'Do both use Firecracker?',
          answer:
            'Yes. Both run each instance in a Firecracker microVM. Gregale manages the instances ' +
            'for you and parks idle apps automatically.',
        },
      ],
      sources: [
        { label: 'Fly.io pricing', url: 'https://fly.io/pricing/' },
        { label: 'Fly.io resource pricing', url: 'https://fly.io/docs/about/pricing/' },
      ],
    },
  ];
}

/** Slugs, for the route list. Must match `comparisons()`. */
export const COMPARISON_SLUGS = ['heroku', 'render', 'railway', 'fly'] as const;
