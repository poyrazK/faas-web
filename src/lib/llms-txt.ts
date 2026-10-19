import { DOC_SECTIONS } from './docs-manifest.ts';
import {
  BETA_STATUS,
  INSTALL_COMMAND,
  RESTORE_CONTEXT,
  RESTORE_DOC_SLUG,
  RESTORE_TARGET,
} from './platform-claims.ts';

/**
 * `/llms.txt`, the summary an assistant reads when asked what Gregale is.
 *
 * Generated at build time by `scripts/prerender.mjs`, next to `robots.txt`
 * and `sitemap.xml`, for the same reason those are: the committed copy went
 * stale within weeks, naming a datacentre the platform had left and stating
 * the wake figure without its boundary. Everything here that can be derived
 * is — the claims from `platform-claims.ts`, the docs list from the manifest —
 * so the file cannot disagree with the page it summarises.
 *
 * Imports are relative and React-free on purpose: this runs under plain
 * Node, where the `@/` alias does not resolve.
 */
export function renderLlmsTxt(siteUrl: string): string {
  const site = siteUrl.replace(/\/$/, '');
  const url = (slug: string) => `${site}/docs/${slug}`;

  const sections = DOC_SECTIONS.map((section) => {
    const entries = section.entries.map(
      (entry) => `- [${entry.title}](${url(entry.slug)}): ${entry.summary}`
    );
    return [`## ${section.title}`, '', ...entries].join('\n');
  });

  return [
    '# Gregale',
    '',
    '> Gregale is an API-hosting platform. It takes an existing HTTP API, service, or background workload from a repository, a Dockerfile, or a Linux/amd64 OCI image, runs it in its own Firecracker microVM with a managed URL, TLS, logs, and metrics, and scales it to zero when idle.',
    '',
    `Status: ${BETA_STATUS} Paid billing and checkout are disabled during the beta; accounts start on the Free plan.`,
    '',
    'Key facts:',
    '',
    '- Isolation: every instance is a Firecracker microVM with its own kernel, not a container sharing the host kernel.',
    `- Scale to zero: an idle app is parked as a VM snapshot and holds no resident memory. ${RESTORE_TARGET}. ${RESTORE_CONTEXT} Details: ${url(RESTORE_DOC_SLUG)}`,
    '- Runtimes: Node 24, Python 3.13, Go 1.24, or any stateless Linux/amd64 OCI image that listens on $PORT.',
    '- Deploy from a local source tree, a tarball, a connected GitHub repository, a Dockerfile, or a registry image. Builds run in isolated builder VMs and can publish an SBOM and provenance.',
    '- Included: custom domains with managed TLS, per-pull-request preview environments, sealed secrets, cron and delayed tasks, queues, edge rules, request tracing, structured logs, and an outbound egress denylist. Maturity per feature is published in the docs.',
    '- Hosted in the EU. The sub-processor list names each provider and where it processes data.',
    `- CLI-first: \`${INSTALL_COMMAND}\`, then \`gregale login\` and \`gregale deploy\`. A web console covers the same account.`,
    '',
    'Check whether a public repository would run before signing up: ' + `${site}/will-it-run`,
    '',
    ...sections.flatMap((section) => [section, '']),
  ].join('\n');
}
