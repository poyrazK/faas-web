import {
  isValidGitHubRepo,
  isValidGitRef,
  newAppPath,
} from '@/components/dashboard/new-app-source';
import { PUBLIC_TEMPLATES, type PublicTemplateEntry } from '@/lib/public-templates';

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

/**
 * Parse either `owner/repo` or a `https://github.com/owner/repo(.git)` URL
 * into a validated `owner/repo` slug. Returns `undefined` for non-GitHub hosts,
 * deep paths, control characters, or malformed inputs.
 */
export function parseDeployRepo(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 512) return undefined;
  if (Array.from(trimmed).some((ch) => ch.charCodeAt(0) <= 0x20 || ch.charCodeAt(0) === 0x7f)) {
    return undefined;
  }
  if (isValidGitHubRepo(trimmed)) return trimmed;

  const candidate = trimmed.startsWith('github.com/') ? `https://${trimmed}` : trimmed;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
  if (!GITHUB_HOSTS.has(parsed.hostname.toLowerCase())) return undefined;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length !== 2) return undefined;
  const owner = parts[0];
  const repo = parts[1].endsWith('.git') ? parts[1].slice(0, -4) : parts[1];
  const combined = `${owner}/${repo}`;
  return isValidGitHubRepo(combined) ? combined : undefined;
}

export function deployButtonSearch(
  repoUrlOrSlug: string,
  ref?: unknown
): { repo: string; ref?: string } {
  const ownerRepo = parseDeployRepo(repoUrlOrSlug);
  const cleanRef = typeof ref === 'string' && isValidGitRef(ref) ? ref.trim() : undefined;
  return {
    repo: ownerRepo ? `https://github.com/${ownerRepo}` : repoUrlOrSlug,
    ...(cleanRef ? { ref: cleanRef } : {}),
  };
}

export function deployDestinationPath(ownerRepo: string, ref?: unknown): string {
  const cleanRef = typeof ref === 'string' && isValidGitRef(ref) ? ref.trim() : undefined;
  return newAppPath({
    source: 'git',
    repo: ownerRepo,
    ...(cleanRef ? { ref: cleanRef } : {}),
  });
}

export function isDeployablePublicTemplate(entry: PublicTemplateEntry): boolean {
  return entry.category === 'Application Starters' || entry.category === 'Remote MCP Servers';
}

export function findPublicTemplateByRepo(ownerRepo: string): PublicTemplateEntry | undefined {
  const target = ownerRepo.trim().toLowerCase();
  return PUBLIC_TEMPLATES.find((entry) => parseDeployRepo(entry.repoUrl)?.toLowerCase() === target);
}

export function deployBadgeMarkdown(ownerRepo: string, siteUrl = 'https://gregale.dev'): string {
  const base = siteUrl.replace(/\/$/, '');
  return `[![Deploy on Gregale](${base}/deploy-badge.svg)](${base}/deploy?repo=https://github.com/${ownerRepo})`;
}
