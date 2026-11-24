import type { FaqEntry } from './faq.ts';

/**
 * Plain-answer articles: one question a buyer asks, answered first, then how
 * Gregale does it and how other platforms compare. The body lives in
 * `content/articles/<slug>.md`; the questions live here so the visible FAQ and
 * its FAQPage structured data come from the same strings.
 *
 * Loaded by `scripts/prerender.mjs` with plain Node: no JSX, no `?raw`.
 */
interface Article {
  slug: string;
  title: string;
  summary: string;
  publishedOn: string;
  updatedOn: string;
  faq: readonly FaqEntry[];
}

export const ARTICLES_TITLE = 'Articles';
export const ARTICLES_DESCRIPTION =
  'Plain answers about how Gregale works, with how other platforms compare.';

const CANARY_SLUG = 'canary-deploys';
const MICROVM_SLUG = 'microvm-isolation';

export const ARTICLES: readonly Article[] = [
  {
    slug: CANARY_SLUG,
    title: 'Canary deploys with automatic rollback',
    summary:
      'Every production release on Gregale goes to 1% of traffic first, moves up in stages on clean evidence, and rolls back on its own on 5xx errors, crash loops or a latency regression.',
    publishedOn: '2026-11-24',
    updatedOn: '2026-11-24',
    faq: [
      {
        question: 'Do I need to change my app to get canary deploys on Gregale?',
        answer:
          'No. Any HTTP app deployed with `gregale deploy` gets them. For better signal on a quiet app, name up to three cheap, read-only probe paths that answer without a login.',
      },
      {
        question: 'What happens to users who hit the new version before a rollback?',
        answer:
          'The new version keeps serving until the previous one is ready again, so there is no window with nothing serving. Send a `Gregale-Version-Key` header if a user must stay on one version for a whole session.',
      },
      {
        question: 'Can I turn it off for an urgent hotfix?',
        answer:
          'Yes: `gregale deploy --rollout immediate` for one deploy, or `gregale app my-api --release-policy immediate` for every deploy. `--rollback-on-5xx=false` turns off the automatic rollback.',
      },
      {
        question: 'What about database migrations?',
        answer:
          'Rolling back code does not undo a migration. Rolling back to the release that was serving when the migration ran needs nothing extra. A rollback that would put older code on a newer schema is refused unless you acknowledge it, and automatic rollbacks never cross a migration: they keep the current release serving and tell you. On paid plans, `gregale rollback --restore-databases` also restores the managed Postgres database to the moment before the migration, as a new database, and moves the app to it.',
      },
      {
        question: 'Does it work with GitHub pushes and Terraform?',
        answer:
          'Yes. Production releases from the GitHub App, `gregale project apply`, the API and Terraform use the same safe rollout.',
      },
    ],
  },
  {
    slug: MICROVM_SLUG,
    title: 'A microVM for every app',
    summary:
      'Gregale runs every app instance in its own Firecracker microVM, with its own kernel, network namespace, memory limit and jailed process. Your existing Dockerfile works unchanged.',
    publishedOn: '2026-11-24',
    updatedOn: '2026-11-24',
    faq: [
      {
        question: 'Does a VM per app make Gregale slow to start?',
        answer:
          'No. Firecracker microVMs boot in a fraction of a second, and an app that has been idle wakes from a memory snapshot of its running process rather than booting from scratch.',
      },
      {
        question: 'Is a microVM the same as a dedicated server?',
        answer:
          'No. Many microVMs share one physical host, but each has its own kernel, memory limit and jailed process, and the hypervisor keeps them apart. It is the isolation model AWS uses for Lambda and Fargate.',
      },
      {
        question: 'If I run several containers together, do they each get a VM?',
        answer:
          'Each deployed app gets its own microVM. Containers you run together as companions inside one deployment (in preview) have separate filesystems and resource limits but share that deployment’s guest kernel, so put workloads that must not trust each other in separate deployments.',
      },
      {
        question: 'Can I run privileged containers or Docker-in-Docker?',
        answer:
          'No. Privileged mode, host devices, host networking and the Docker socket are not supported. Builds run in their own short-lived microVMs, not on a shared Docker daemon.',
      },
      {
        question: 'Does isolation replace my own security work?',
        answer:
          'No. Gregale isolates workloads and filters network egress; you still own application authorization, dependency hygiene and data classification.',
      },
    ],
  },
];

/** FAQ answers as plain text, for structured data: no Markdown code spans. */
export function plainFaq(entries: readonly FaqEntry[]): FaqEntry[] {
  return entries.map(({ question, answer }) => ({ question, answer: answer.replaceAll('`', '') }));
}

const CANARY_LINK = `[Canary deploys with automatic rollback](/articles/${CANARY_SLUG}) explains the default rollout and what rolls a release back, and compares it with other platforms.`;
const MICROVM_LINK = `[A microVM for every app](/articles/${MICROVM_SLUG}) explains what each app's microVM isolates, and compares it with other platforms.`;

const RELATED_ARTICLES: Record<string, string> = {
  rollouts: CANARY_LINK,
  releases: CANARY_LINK,
  'release-controls': CANARY_LINK,
  security: MICROVM_LINK,
  compliance: MICROVM_LINK,
  'container-compatibility': MICROVM_LINK,
};

export function withRelatedArticles(slug: string, source: string): string {
  const related = RELATED_ARTICLES[slug];
  return related ? `${source.trimEnd()}\n\n## Related articles\n\n${related}\n` : source;
}

export function articleDate(date: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(date)
  );
}
