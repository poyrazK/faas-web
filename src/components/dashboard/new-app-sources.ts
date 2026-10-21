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
    desc: 'Build and deploy one service from a branch, tag, or commit, right from the console.',
  },
  {
    id: 'template',
    name: 'Template',
    desc: 'Start with sample code. Create the app here, then deploy it with the CLI.',
  },
  {
    id: 'empty',
    name: 'Empty app',
    desc: 'Create the app without a deployment. Add code from the CLI or CI later.',
  },
  {
    id: 'container',
    name: 'Container image',
    desc: 'Deploy an immutable HTTP image by digest. No GitHub connection required.',
  },
  {
    id: 'worker',
    name: 'Long-lived worker',
    desc: 'Deploy a pinned OCI worker without an HTTP listener. Hobby or above.',
  },
  {
    id: 'import',
    name: 'Import',
    desc: 'A repository with several services (Compose, Procfile, k8s, Render, Fly, or serverless), scanned and created together as a project.',
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
