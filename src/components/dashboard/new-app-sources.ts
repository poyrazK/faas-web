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
    desc: 'Build and deploy a branch, tag, or commit.',
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

/** The common path first: most people arrive with code, not an image or a
 * multi-service repository. The order inside a group is the order shown. */
export const SOURCE_GROUPS: readonly { title: string; sources: readonly AppSource[] }[] = [
  { title: 'From code', sources: ['git', 'template', 'empty'] },
  { title: 'From an image', sources: ['container', 'worker'] },
  { title: 'Bring an existing project', sources: ['import'] },
];

export function sourceName(id?: AppSource): string {
  return SOURCES.find((s) => s.id === id)?.name ?? '';
}
