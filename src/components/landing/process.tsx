import { useId, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { DeployFlow, Mark } from './deploy-flow';

/** Small line icons for the guide row, drawn on one 16-unit grid. */
const Line = ({ children }: { children: ReactNode }) => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.4}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className="shrink-0"
  >
    {children}
  </svg>
);

const ICONS: Record<string, ReactNode> = {
  // code brackets: your source tree
  'deploy-from-source': (
    <Line>
      <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3 7 13" />
    </Line>
  ),
  // a branch off main: a connected repository
  'deploy-from-github': (
    <Line>
      <circle cx="4.5" cy="3.5" r="1.6" />
      <circle cx="4.5" cy="12.5" r="1.6" />
      <circle cx="11.5" cy="5.5" r="1.6" />
      <path d="M4.5 5.1v5.8M11.5 7.1c0 2.6-2.2 3.4-5.4 4.4" />
    </Line>
  ),
  // a chip: the runtime your code runs on
  'runtime-node': (
    <Line>
      <rect x="4" y="4" width="8" height="8" rx="1.6" />
      <path d="M6.5 1.8V4M9.5 1.8V4M6.5 12v2.2M9.5 12v2.2M1.8 6.5H4M1.8 9.5H4M12 6.5h2.2M12 9.5h2.2" />
      <rect x="6.5" y="6.5" width="3" height="3" rx=".6" />
    </Line>
  ),
  // a sealed envelope: configuration kept out of your source
  storage: (
    <Line>
      <rect x="2" y="3.5" width="12" height="9" rx="1.6" />
      <path d="m2.5 4.5 5.5 4 5.5-4" />
      <circle cx="8" cy="10.2" r="1.3" />
    </Line>
  ),
};

/** Claude, ChatGPT and Gemini as one overlapping cluster. */
function AgentMarks() {
  return (
    <span className="flex shrink-0 items-center" aria-hidden>
      {(['claude', 'openai', 'gemini'] as const).map((m, i) => (
        <span
          key={m}
          data-mark={m}
          className="grid size-[19px] place-items-center rounded-full bg-muted text-foreground ring-2 ring-background"
          style={{ marginLeft: i ? -5 : 0, zIndex: 3 - i }}
        >
          <Mark name={m} size={11} />
        </span>
      ))}
    </span>
  );
}

/** The guides this section hands off to, kept as a quiet row under the picture. */
export const DEPLOY_GUIDES = [
  { label: 'Deploy from source', doc: 'deploy-from-source' },
  { label: 'Deploy from GitHub', doc: 'deploy-from-github' },
  { label: 'Runtime guide', doc: 'runtime-node' },
  { label: 'Sealed configuration', doc: 'storage' },
  { label: 'Use Gregale from coding agents', doc: 'agents' },
] as const;

export function Process() {
  const id = useId();
  return (
    <section
      id="deploy"
      aria-labelledby={`${id}-title`}
      className="relative scroll-mt-24 border-t border-border"
    >
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <h2
          id={`${id}-title`}
          className="max-w-[30rem] text-balance text-[40px] font-medium leading-[1.05] tracking-[-0.02em] text-foreground sm:text-[52px]"
        >
          From repository to running API.
        </h2>
        <div className="mt-10 lg:mt-12 xl:-mx-12">
          <DeployFlow />
        </div>
        <nav aria-label="Deploy guides" className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-sm">
          {DEPLOY_GUIDES.map((g) => (
            <Link
              key={g.doc}
              to="/docs/$slug"
              params={{ slug: g.doc }}
              className="group inline-flex items-center gap-2 text-muted-foreground underline-offset-4 transition-colors hover:text-foreground"
            >
              {g.doc === 'agents' ? <AgentMarks /> : ICONS[g.doc]}
              <span className="group-hover:underline">{g.label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </section>
  );
}
