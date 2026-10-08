import { useId } from 'react';
import { Cards, Panel, type CardItem } from './cards';
import { DeploymentPreview } from './product-previews';

export type Step = CardItem;

export const STEPS: readonly Step[] = [
  {
    title: 'Bring your repository.',
    body: 'Start from your source tree or a connected GitHub repository. Keep your framework and packages; use a Dockerfile or supported OCI image when you need control over the build.',
    mosaic: [
      [1, 4, 2],
      [2, 3, 1],
      [3, 2, 0],
      [4, 1, 1],
      [5, 0, 0],
      [3, 4, 2],
      [5, 2, 2],
    ],
    links: [{ label: 'Deploy from a ref', doc: 'deploy-from-source' }],
    panel: (
      <Panel
        title="example · source tree"
        rows={['my-api/', '  src/server.ts', '  package.json', '  gregale deploy --dry-run']}
      />
    ),
  },
  {
    title: 'Set your configuration.',
    body: 'Review the start command, listening port and resource limits. Add environment variables and sealed secrets outside your source code before deploying.',
    links: [
      { label: 'Runtime guide', doc: 'runtime-node' },
      { label: 'Sealed configuration', doc: 'storage' },
    ],
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
        title="example · configuration"
        rows={['start  npm start', 'port   8080', 'secret DATABASE_URL · sealed']}
      />
    ),
  },
  {
    title: 'Deploy and verify.',
    body: 'Follow the build and readiness checks to a verified URL. Inspect logs when something fails, then deploy your next change through the same path.',
    links: [{ label: 'Deployment guide', doc: 'deploy-from-github' }],
    mosaic: [
      [5, 0, 0],
      [4, 1, 2],
      [3, 2, 0],
      [2, 3, 1],
      [4, 3, 1],
      [5, 4, 2],
      [6, 2, 2],
    ],
    panel: <DeploymentPreview />,
  },
];

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
        <p className="mt-5 max-w-[34rem] text-base leading-relaxed text-muted-foreground">
          A first deployment in three steps. Start with a non-critical API during the public beta.
        </p>
        <Cards items={STEPS} defaultOpen={0} className="mt-10 lg:mt-12" />
      </div>
    </section>
  );
}
