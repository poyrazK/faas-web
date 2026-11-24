import { useId } from 'react';
import { Link } from '@tanstack/react-router';
import { DeployFlow } from './deploy-flow';

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
        <p className="mt-5 max-w-[36rem] text-base leading-relaxed text-muted-foreground">
          You, or your agent, point Gregale at a repository. It builds, checks and serves it, and
          every pull request gets its own preview.
        </p>
        <div className="mt-10 lg:-mx-12 lg:mt-12">
          <DeployFlow />
        </div>
        <nav aria-label="Deploy guides" className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {DEPLOY_GUIDES.map((g) => (
            <Link
              key={g.doc}
              to="/docs/$slug"
              params={{ slug: g.doc }}
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {g.label} →
            </Link>
          ))}
        </nav>
      </div>
    </section>
  );
}
