import { RESTORE_TARGET } from './platform-claims.ts';

/**
 * The documentation table of contents.
 *
 * **This is a curated subset, not a mirror.** `poyrazK/faas` carries roughly
 * 200 markdown files, and most of them are not documentation in the sense a
 * customer means it:
 *
 * - `docs/runbooks/*` (~40) are incident-response procedures. They name alert
 *   thresholds, failover steps, and internal hostnames. Publishing them hands
 *   an attacker a map.
 * - `docs/adr/*` (~100) are architecture decision records — the reasoning
 *   behind internal design, written for the people maintaining it.
 * - `docs/ops/*`, `docs/drills/*`, `deploy/*` are operator procedures for
 *   running the platform, not for using it.
 * - `docs/faas_implementation_spec.md`, `repo_decomposition_implementation.md`
 *   and friends are engineering planning documents.
 *
 * What is left is the genuinely customer-facing material, listed below. Each
 * entry pins a source path so `npm run docs:pull` can refresh it, and a slug
 * that becomes the URL — slugs are stable and independent of upstream paths, so
 * a file moving upstream does not break a published link.
 *
 * Order within a section is the reading order, and it drives prev/next.
 */

export interface DocEntry {
  /** URL segment under /docs. Stable; do not rename once published. */
  slug: string;
  /** Path in the upstream repository. */
  source: string;
  /** Locally authored customer guides must not be overwritten by docs:pull. */
  local?: boolean;
  title: string;
  /** One line, used on the index and as the meta description. */
  summary: string;
}

export interface DocSection {
  title: string;
  /** Shown under the section heading on the index page. */
  blurb: string;
  entries: DocEntry[];
}

export const DOC_SECTIONS: DocSection[] = [
  {
    title: 'Start here',
    blurb: 'Deploy a first app, then bring your own repository.',
    entries: [
      {
        slug: 'getting-started',
        source: 'content/docs/getting-started.md',
        local: true,
        title: 'Deploy your first app',
        summary: 'Install the CLI, deploy a starter API, and verify its live URL.',
      },
      {
        slug: 'quickstart',
        source: 'docs/quickstart.md',
        title: 'Guided first deploy',
        summary:
          'Let `gregale start` detect, review, and launch an existing project, then iterate on it.',
      },
      {
        slug: 'deploy-from-github',
        source: 'docs/deploys.md',
        title: 'Deploy from your repository',
        summary: 'Deploy a source checkout, connect GitHub, or use GitHub Actions.',
      },
      {
        slug: 'deploy-from-source',
        source: 'docs/source-ref.md',
        title: 'Deploy a GitHub source ref',
        summary: 'Pin a branch, tag, or commit for a reproducible CI deployment.',
      },
      {
        slug: 'cli',
        source: 'docs/cli-setup.md',
        title: 'CLI completion & man pages',
        summary: 'Set up shell completion and offline command reference.',
      },
    ],
  },
  {
    title: 'Run your app',
    blurb: 'Scaling, domains, storage, and preview environments.',
    entries: [
      {
        slug: 'scale-to-zero',
        source: 'docs/cold-wake.md',
        title: 'How scaling to zero works',
        summary: `Parked apps hold zero resident RAM. ${RESTORE_TARGET}. Measurement boundaries and cold-boot fallback.`,
      },
      {
        slug: 'scaling-policy',
        source: 'docs/scaling-policy.md',
        title: 'Scaling policy',
        summary:
          'Instance bounds, scaling signals, custom metrics, and scheduled warm windows per app.',
      },
      {
        slug: 'storage',
        source: 'docs/storage.md',
        title: 'Storage',
        summary:
          'What the platform stores per app: VM snapshots, image layers, and what you pay for.',
      },
      {
        slug: 'object-storage',
        source: 'docs/object-storage.md',
        title: 'Object storage',
        summary: 'Preview: managed object buckets, credentials, and storage rollout limits.',
      },
      {
        slug: 'custom-domains',
        source: 'docs/domains.md',
        title: 'Custom domains',
        summary: 'Attach, verify, and diagnose your own domain on a deployed app.',
      },
      {
        slug: 'executions',
        source: 'docs/executions.md',
        title: 'Disposable executions',
        summary: 'Run bounded Node.js or Python work in a fresh isolated microVM.',
      },
      {
        slug: 'preview-environments',
        source: 'docs/preview-environments.md',
        title: 'Preview environments',
        summary: 'Per-PR deployments with their own URL, shared app quotas, and cleanup lifecycle.',
      },
      {
        slug: 'dev',
        source: 'docs/gregale-dev.md',
        title: 'Remote dev environments',
        summary:
          'Sync local code to a cloud dev environment with a stable URL, live patches, and debugging.',
      },
    ],
  },
  {
    title: 'Configure',
    blurb: 'What an app is given, and where it may reach.',
    entries: [
      {
        slug: 'env',
        source: 'docs/env.md',
        title: 'Environment variables',
        summary:
          'Non-secret configuration, its precedence, history, rollback, and the config guard.',
      },
      {
        slug: 'deploy-overrides',
        source: 'docs/deploy-overrides.md',
        title: 'Deployment overrides',
        summary: 'Pin the start command, port, health path, and readiness probe in gregale.yaml.',
      },
      {
        slug: 'build',
        source: 'docs/build.md',
        title: 'Builds and framework detection',
        summary:
          'How a framework is detected and built, how to override it, and how to read a failure.',
      },
      {
        slug: 'companions',
        source: 'docs/companions.md',
        title: 'Application companions',
        summary:
          'Run a collector, proxy, or other helper alongside an app, with probes and dependencies.',
      },
      {
        slug: 'registry-credentials',
        source: 'docs/registry-credentials.md',
        title: 'Private registry credentials',
        summary: 'Store write-only credentials so private OCI images can be pulled at deploy time.',
      },
      {
        slug: 'static-egress-ip',
        source: 'docs/static-egress-ip.md',
        title: 'Static egress IP',
        summary: 'Reserve a fixed outbound address an upstream service can allowlist.',
      },
      {
        slug: 'queue-pull-leases',
        source: 'docs/queue-pull-leases.md',
        title: 'Pull queue leases',
        summary:
          'Consume queue messages from a worker without an HTTP listener: lease, ack, nack, extend.',
      },
    ],
  },
  {
    title: 'Observe',
    blurb: 'What the platform can tell you about a request.',
    entries: [
      {
        slug: 'tracing',
        source: 'docs/tracing.md',
        title: 'Request tracing',
        summary:
          'One-setting OpenTelemetry tracing to see slow or failing dependencies per request.',
      },
      {
        slug: 'synthetic-checks',
        source: 'docs/synthetic-checks.md',
        title: 'Synthetic checks',
        summary:
          'Probe a path on a schedule from outside, track uptime and latency, alert on failure.',
      },
      {
        slug: 'edge-rule-trace',
        source: 'docs/edge-rule-trace.md',
        title: 'Trace edge rules',
        summary:
          'Replay a request against an app’s edge rules from a JSON scenario to see what applies.',
      },
    ],
  },
  {
    title: 'Runtimes',
    blurb: 'The managed runtimes, and what each one gives you.',
    entries: [
      {
        slug: 'runtime-node',
        source: 'docs/runtimes/node24.md',
        title: 'Node 24',
        summary: 'The Node runtime: entrypoint, build behaviour, and what ships in the image.',
      },
      {
        slug: 'runtime-python',
        source: 'docs/runtimes/python313.md',
        title: 'Python 3.13',
        summary: 'The Python runtime: entrypoint, dependency install, and image contents.',
      },
      {
        slug: 'runtime-go',
        source: 'docs/runtimes/go124.md',
        title: 'Go 1.24',
        summary: 'The Go runtime, including the Alpine variant and static build behaviour.',
      },
      {
        slug: 'trace-propagation',
        source: 'docs/runtimes/trace-propagation.md',
        title: 'Trace propagation',
        summary: 'How trace context travels through the gateway into your handler.',
      },
    ],
  },
  {
    title: 'Reference',
    blurb: 'Limits and rules the platform enforces.',
    entries: [
      {
        slug: 'plans',
        source: 'docs/plans.md',
        title: 'Plans and pricing',
        summary: 'Generated platform prices, included compute, and hard plan limits.',
      },
      {
        slug: 'egress-denylist',
        source: 'docs/denylist.md',
        title: 'Egress denylist',
        summary: 'Destinations outbound traffic cannot reach, and why.',
      },
      {
        slug: 'api-hosting-openapi',
        source: 'docs/api-hosting-openapi.md',
        title: 'OpenAPI hosting',
        summary: 'Preview, compare, and publish an OpenAPI contract for an app.',
      },
      {
        slug: 'faas_openapi_spec',
        source: 'docs/faas_openapi_spec.md',
        title: 'Gregale API specification',
        summary: 'The OpenAPI contract, supported routes, response shapes, and CI guarantees.',
      },
      {
        slug: 'account',
        source: 'docs/account.md',
        title: 'Account and organizations',
        summary:
          'Identity, organizations, members, feature availability, data export, and deletion.',
      },
      {
        slug: 'api-monetization',
        source: 'docs/api-monetization.md',
        title: 'API monetization',
        summary:
          'Beta: meter, price, and invoice your API’s own customers with rate cards and statements.',
      },
    ],
  },
  {
    title: 'Trust',
    blurb: 'Legal and security commitments.',
    entries: [
      {
        slug: 'compliance',
        source: 'docs/compliance/README.md',
        title: 'Compliance overview',
        summary: 'The controls the platform operates under and how they are evidenced.',
      },
      {
        slug: 'dpa',
        source: 'docs/DPA.md',
        title: 'Data Processing Agreement',
        summary: 'The DPA governing personal data processed on your behalf.',
      },
      {
        slug: 'subprocessors',
        source: 'docs/compliance/subprocessors.md',
        title: 'Sub-processors',
        summary: 'Third parties with access to customer data, and what each one does.',
      },
      {
        slug: 'responsible-disclosure',
        source: 'docs/compliance/responsible-disclosure.md',
        title: 'Responsible disclosure',
        summary: 'How to report a vulnerability, and what to expect once you do.',
      },
      {
        slug: 'security',
        source: 'docs/security.md',
        title: 'Security',
        summary: 'Gregale isolation boundaries and the security responsibilities you retain.',
      },
    ],
  },
];

/** Flat reading order, for prev/next and for the prerender route list. */
export const DOC_ENTRIES: DocEntry[] = DOC_SECTIONS.flatMap((section) => section.entries);

export function findDoc(slug: string): DocEntry | undefined {
  return DOC_ENTRIES.find((entry) => entry.slug === slug);
}

/** The entry before and after `slug` in reading order, for the page footer. */
export function docNeighbours(slug: string): { prev?: DocEntry; next?: DocEntry } {
  const index = DOC_ENTRIES.findIndex((entry) => entry.slug === slug);
  if (index === -1) return {};
  return { prev: DOC_ENTRIES[index - 1], next: DOC_ENTRIES[index + 1] };
}
