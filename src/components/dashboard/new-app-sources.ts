import type { AppSource } from './new-app-source';

export interface SourceOption {
  id: AppSource;
  name: string;
  desc: string;
}

/** Git deploys immediately; empty/template apps await CLI deployment.
 * Import keeps the existing project scan/apply contract inside this flow. */
export const SOURCES: readonly SourceOption[] = [
  {
    id: 'git',
    name: 'Git repository',
    desc: 'Choose a GitHub repository and branch. Gregale builds and deploys your code.',
  },
  {
    id: 'function',
    name: 'Function',
    desc: 'Write a JavaScript or Python handler here and deploy it. No repository needed.',
  },
  {
    id: 'template',
    name: 'Template',
    desc: 'Choose starter code. Create the app here, then deploy with the CLI.',
  },
  {
    id: 'empty',
    name: 'Empty app',
    desc: 'Create an app without code. Deploy later with the CLI.',
  },
  {
    id: 'container',
    name: 'Container image',
    desc: 'Deploy a container image that serves a website or API.',
  },
  {
    id: 'worker',
    name: 'Long-lived worker',
    desc: 'Run a container continuously in the background, without a public URL.',
  },
  {
    id: 'import',
    name: 'Import',
    desc: 'Upload a repository archive. Preview and create its apps together.',
  },
];

export function sourceName(id?: AppSource): string {
  return SOURCES.find((s) => s.id === id)?.name ?? '';
}
