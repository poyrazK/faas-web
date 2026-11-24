import { LANDING_FAQ } from '@/lib/faq';
import { Cards, Panel, type CardItem } from './cards';

const QUESTIONS: readonly CardItem[] = [
  {
    title: LANDING_FAQ[0].question,
    body: LANDING_FAQ[0].answer,
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
        rows={['Sign up on Free', 'Deploy from source or GitHub', 'Live URL with TLS']}
      />
    ),
  },
  {
    title: LANDING_FAQ[1].question,
    body: LANDING_FAQ[1].answer,
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
    title: LANDING_FAQ[2].question,
    body: LANDING_FAQ[2].answer,
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
    title: LANDING_FAQ[3].question,
    body: LANDING_FAQ[3].answer,
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
    links: [{ label: 'Plans and included usage', doc: 'plans' }],
    panel: (
      <Panel
        title="Plans and billing"
        rows={['Free to start', 'Plans from the catalog', 'Included usage per plan']}
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
