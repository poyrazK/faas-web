import { Cards, Panel, type CardItem } from './cards';

const QUESTIONS: readonly CardItem[] = [
  {
    title: 'Can I start using Gregale today?',
    body: 'Yes. Hosting is in public beta. Start with a demo, side project or another non-critical workload.',
    mosaic: [
      [1, 4, 2],
      [2, 3, 1],
      [3, 2, 0],
      [4, 1, 1],
      [5, 0, 0],
      [3, 4, 2],
      [5, 2, 2],
    ],
    panel: (
      <Panel
        title="Start with hosting"
        rows={['Public beta', 'Demo or side project', 'Non-critical workloads']}
      />
    ),
  },
  {
    title: 'What stays in my application?',
    body: 'Your business logic, user authorization and data-isolation rules. You also handle effects in external systems, including duplicate requests where needed.',
    mosaic: [
      [1, 0, 2],
      [2, 1, 0],
      [1, 2, 1],
      [3, 2, 2],
      [4, 1, 1],
      [5, 0, 0],
      [4, 3, 0],
      [5, 4, 1],
      [2, 4, 2],
    ],
    panel: (
      <Panel
        title="Your application owns"
        rows={['Business logic', 'Authorization and data isolation', 'Effects in external systems']}
      />
    ),
  },
  {
    title: 'Does my application have to run all the time?',
    body: 'With scale-to-zero enabled, eligible idle applications can stop consuming compute and wake when traffic returns. The first request waits for the wake. Long-running workers have different lifecycle behavior.',
    mosaic: [
      [5, 0, 0],
      [4, 1, 2],
      [3, 2, 0],
      [2, 3, 1],
      [4, 3, 1],
      [5, 4, 2],
      [6, 2, 2],
    ],
    links: [{ label: 'How scaling to zero works', doc: 'scale-to-zero' }],
    panel: (
      <Panel
        title="Optional scale-to-zero"
        rows={[
          'Eligible idle apps can park',
          'The first request waits for wake',
          'Workers have a different lifecycle',
        ]}
      />
    ),
  },
  {
    title: 'What does it cost?',
    body: 'See the current plans, usage limits and beta billing details.',
    mosaic: [
      [5, 0, 0],
      [3, 1, 1],
      [5, 1, 2],
      [4, 2, 1],
      [5, 3, 0],
      [3, 4, 0],
      [4, 4, 1],
      [6, 4, 2],
    ],
    links: [{ label: 'Plans, limits and beta billing', doc: 'plans' }],
    panel: (
      <Panel
        title="Plans and billing"
        rows={['Current plans', 'Included usage and limits', 'Beta billing details']}
      />
    ),
  },
];

export function PracticalQuestions() {
  return (
    <section
      id="questions"
      aria-labelledby="questions-title"
      className="relative scroll-mt-24 border-t border-border"
    >
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <h2
          id="questions-title"
          className="max-w-[30rem] text-balance text-[40px] font-medium leading-[1.05] tracking-[-0.02em] text-foreground sm:text-[52px]"
        >
          A few practical questions.
        </h2>
        <Cards items={QUESTIONS} defaultOpen={0} className="mt-10 lg:mt-12" />
      </div>
    </section>
  );
}
