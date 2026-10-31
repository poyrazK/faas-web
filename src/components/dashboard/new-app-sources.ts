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
    desc: 'Build and deploy a function or an app from a branch, tag, or commit.',
  },
  {
    id: 'function',
    name: 'Function',
    desc: 'Write a handler here. No repository needed.',
  },
  {
    id: 'template',
    name: 'Template',
    desc: 'Start from a ready-made starter.',
  },
  {
    id: 'empty',
    name: 'Empty app',
    desc: 'Create it now, deploy code later.',
  },
  {
    id: 'container',
    name: 'Container image',
    desc: 'Run an HTTP image you already built.',
  },
  {
    id: 'worker',
    name: 'Long-lived worker',
    desc: 'Run a background process with no HTTP port.',
  },
  {
    id: 'import',
    name: 'Import',
    desc: 'Turn a repository with several services into a project.',
  },
];

export function sourceName(id?: AppSource): string {
  return SOURCES.find((s) => s.id === id)?.name ?? '';
}
