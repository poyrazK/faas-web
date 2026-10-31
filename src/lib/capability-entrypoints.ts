import { findDoc } from './docs-manifest';

/** Registry links are data, not navigation authority. Only published customer docs. */
export function safeCapabilityDocs(value: string): string | undefined {
  if (!value.startsWith('/docs/') && !value.startsWith('https://gregale.dev/docs/')) return;
  const relative = value.replace(/^https:\/\/gregale\.dev/, '');
  if (/[\\\s%]/.test(relative)) return;
  const path = relative.split(/[?#]/)[0];
  const slug = path.slice('/docs/'.length);
  if (!/^[a-z0-9-]+$/.test(slug) || !findDoc(slug)) return;
  return relative;
}
interface Entrypoint {
  href?: string;
  label?: string;
  instruction?: string;
}
const TARGETS: Record<string, Entrypoint> = {
  'object-storage': { href: '/dashboard/storage', label: 'Open storage' },
  'github-deploys': { href: '/dashboard/apps/new?source=git', label: 'Deploy from Git' },
  'source-deploy': { href: '/dashboard/apps/new', label: 'Create an app' },
  'custom-domains': { href: '/dashboard/domains', label: 'Open domains' },
  'scale-to-zero': { href: '/dashboard/apps', label: 'Choose an app' },
  'workflows-and-jobs': { href: '/dashboard/jobs?section=automations', label: 'Open automations' },
  'container-deployments': {
    href: '/dashboard/apps/new?source=container',
    label: 'Deploy an image',
  },
  'worker-pools': {
    href: '/dashboard/apps/new?source=worker',
    label: 'Create an OCI worker',
  },
  'disposable-runs': {
    instruction: 'Use the CLI or API for isolated runs (`gregale run --help`).',
  },
  'pr-previews': { href: '/dashboard/releases', label: 'Open releases' },
  issues: { href: '/dashboard/apps', label: 'Choose an app, then open Issues' },
  companions: { href: '/dashboard/apps', label: 'Choose an app, then open Companions' },
  'private-apps': { href: '/dashboard/apps/new', label: 'Create an app' },
  'internal-services': { href: '/dashboard/apps', label: 'Choose an app, then open Services' },
  'mcp-hosting': { href: '/dashboard/apps', label: 'Choose an app, then open MCP' },
};
export function capabilityEntrypoint(key: string): Entrypoint {
  return (
    TARGETS[key] ?? {
      instruction:
        'No dedicated console setup yet. Use the documented CLI or API workflow; availability does not confirm execution health.',
    }
  );
}
