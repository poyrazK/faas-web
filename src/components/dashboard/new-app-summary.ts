import type { AppSource } from './new-app-source';
import { sourceName } from './new-app-sources';

export interface SummaryRow {
  key: string;
  label: string;
  value: string;
  /** Identifiers (names, refs, URLs) read better in the mono face. */
  mono?: boolean;
}

export interface SummaryInput {
  /** 0 Source, 1 Configure, 2 Review: rows appear once their step is reached. */
  step: 0 | 1 | 2;
  source?: AppSource;
  repo: string;
  ref: string;
  templateName?: string;
  name: string;
  workspaceLabel: string;
  workspaceIsOrg: boolean;
  appType: 'function' | 'app';
  runtimeLabel?: string;
  memoryMb: number;
  scaleToZero: boolean;
  visibility: 'public' | 'internal';
  predictedUrl?: string;
}

/**
 * What the app will be, as far as the person has told us. One list feeds the
 * rail (as it fills in) and Review (in full), so the two cannot drift. A row
 * appears only once its value is known: nothing here is a guessed default.
 */
export function summaryRows(i: SummaryInput): SummaryRow[] {
  if (!i.source) return [];
  const repoRef = `${i.repo.trim()}@${i.ref.trim() || 'main'}`;
  const rows: SummaryRow[] = [{ key: 'source', label: 'Source', value: sourceName(i.source) }];
  if (i.source === 'git' && i.repo.trim())
    rows.push({ key: 'repository', label: 'Repository', value: repoRef, mono: true });
  if (i.source === 'template' && i.templateName)
    rows.push({ key: 'template', label: 'Template', value: i.templateName, mono: true });
  if (i.name) rows.push({ key: 'name', label: 'Name', value: i.name, mono: true });
  if (i.workspaceIsOrg || i.step >= 2)
    rows.push({ key: 'workspace', label: 'Workspace', value: i.workspaceLabel });
  if (i.step >= 1) {
    rows.push({ key: 'type', label: 'Type', value: i.appType === 'app' ? 'App' : 'Function' });
    if (i.appType === 'function' && i.runtimeLabel)
      rows.push({ key: 'runtime', label: 'Runtime', value: i.runtimeLabel });
    rows.push({ key: 'memory', label: 'Memory', value: `${i.memoryMb} MB`, mono: true });
    rows.push({
      key: 'scale',
      label: 'Scale to zero',
      value: i.scaleToZero ? 'Parks when idle' : 'One instance kept resident',
    });
    rows.push({
      key: 'visibility',
      label: 'Visibility',
      value: i.visibility === 'internal' ? 'Internal service only' : 'Public edge',
    });
  }
  if (i.step >= 2) {
    rows.push(
      i.source === 'git'
        ? {
            key: 'first-deploy',
            label: 'First deploy',
            value: `${repoRef}, right after create`,
            mono: true,
          }
        : { key: 'first-deploy', label: 'First deploy', value: 'Later, from the CLI' }
    );
    rows.push(
      i.visibility === 'internal'
        ? { key: 'url', label: 'Public URL', value: 'None (internal service only)' }
        : i.predictedUrl
          ? { key: 'url', label: 'Public URL', value: i.predictedUrl, mono: true }
          : { key: 'url', label: 'Public URL', value: 'Assigned on create' }
    );
  }
  return rows;
}
