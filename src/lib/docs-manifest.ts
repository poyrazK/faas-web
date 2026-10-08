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
        slug: 'tracing',
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
