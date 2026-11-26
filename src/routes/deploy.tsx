import { useState, type FormEvent } from 'react';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { ArrowRight, ArrowUpRight } from 'iconoir-react';
import { MotionConfig } from 'motion/react';
import { Nav } from '@/components/landing/nav';
import { Footer } from '@/components/landing/footer';
import { Button } from '@/components/ui/button';
import { CopyIconButton } from '@/components/ui/copy-button';
import { Input } from '@/components/ui/input';
import { isValidGitRef } from '@/components/dashboard/new-app-source';
import { readSession } from '@/lib/auth';
import {
  deployBadgeMarkdown,
  deployDestinationPath,
  findPublicTemplateByRepo,
  parseDeployRepo,
} from '@/lib/deploy-link';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/deploy')({
  head: () =>
    pageHead({
      title: 'Deploy on Gregale',
      description: 'Deploy any public GitHub repository or Gregale starter template in one click.',
    }),
  validateSearch: (search: Record<string, unknown>): { repo?: string; ref?: string } => {
    const rawRepo =
      typeof search.repo === 'string' && search.repo.length <= 512 ? search.repo.trim() : undefined;
    const rawRef =
      typeof search.ref === 'string'
        ? search.ref
        : typeof search.branch === 'string'
          ? search.branch
          : undefined;
    const ref = typeof rawRef === 'string' && isValidGitRef(rawRef) ? rawRef.trim() : undefined;
    return {
      ...(rawRepo ? { repo: rawRepo } : {}),
      ...(ref ? { ref } : {}),
    };
  },
  beforeLoad: ({ search }) => {
    const ownerRepo = parseDeployRepo(search.repo);
    if (readSession() && ownerRepo) {
      throw redirect({
        to: '/dashboard/apps/new',
        search: {
          source: 'git',
          repo: ownerRepo,
          ...(search.ref ? { ref: search.ref } : {}),
        },
      });
    }
  },
  component: DeployPage,
});

function DeployPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const ownerRepo = parseDeployRepo(search.repo);
  const matchedTemplate = ownerRepo ? findPublicTemplateByRepo(ownerRepo) : undefined;

  const [draft, setDraft] = useState(search.repo ?? '');
  const [formError, setFormError] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseDeployRepo(draft);
    if (!parsed) {
      setFormError('Enter a valid public GitHub URL or owner/repo slug.');
      return;
    }
    setFormError(null);
    void navigate({ search: { repo: `https://github.com/${parsed}`, ref: search.ref } });
  }

  const nextPath = ownerRepo ? deployDestinationPath(ownerRepo, search.ref) : undefined;
  const repoShortName = ownerRepo ? ownerRepo.split('/')[1] : undefined;
  const cliCommand = ownerRepo
    ? (matchedTemplate?.command ??
      `git clone https://github.com/${ownerRepo}.git && cd ${repoShortName} && gregale deploy --name ${repoShortName}`)
    : undefined;
  const badgeSnippet = ownerRepo ? deployBadgeMarkdown(ownerRepo) : undefined;

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-background text-foreground">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Nav />
        <main id="main" className="mx-auto max-w-3xl px-4 pb-24 pt-32 sm:px-6 lg:pt-40">
          <p className="label-mono text-brand">One-click repository deploy</p>
          <h1 className="mt-3 text-balance text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
            Deploy on Gregale
          </h1>

          {ownerRepo && nextPath && cliCommand && badgeSnippet ? (
            <div className="mt-8 space-y-6">
              <div className="rounded-2xl border border-border bg-card p-6">
                <p className="label-mono text-brand">
                  {matchedTemplate ? matchedTemplate.runtime : 'GitHub repository'}
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-2xl font-medium tracking-tight">
                    {matchedTemplate ? matchedTemplate.title : ownerRepo}
                  </h2>
                  <a
                    href={`https://github.com/${ownerRepo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-medium text-brand underline-offset-4 hover:underline"
                  >
                    github.com/{ownerRepo}
                    <ArrowUpRight aria-hidden="true" className="size-4" />
                  </a>
                </div>
                {matchedTemplate ? (
                  <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                    {matchedTemplate.summary}
                  </p>
                ) : (
                  <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                    Create a free Gregale account or sign in to connect{' '}
                    <span className="font-mono text-foreground">{ownerRepo}</span>
                    {search.ref ? (
                      <>
                        {' '}
                        at ref <span className="font-mono text-foreground">{search.ref}</span>
                      </>
                    ) : null}{' '}
                    and deploy inside an isolated Firecracker microVM.
                  </p>
                )}

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Button asChild variant="cta" className="h-10 rounded-full px-5">
                    <Link to="/signup" search={{ next: nextPath }}>
                      Deploy on Gregale — Start free
                      <ArrowRight aria-hidden="true" className="ml-1.5 size-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="h-10 rounded-full px-5">
                    <Link to="/login" search={{ next: nextPath }}>
                      Sign in to deploy
                    </Link>
                  </Button>
                  <Link
                    to="/will-it-run"
                    search={{ source: ownerRepo, ref: search.ref }}
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    Check compatibility first
                  </Link>
                  {matchedTemplate && (
                    <Link
                      to="/docs/$slug"
                      params={{ slug: matchedTemplate.docSlug }}
                      className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      Docs
                    </Link>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-border p-6 space-y-5">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">Deploy with the CLI</p>
                    <CopyIconButton text={cliCommand} label="CLI deploy command" />
                  </div>
                  <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">
                    <code>{cliCommand}</code>
                  </pre>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">Embed Deploy button in README.md</p>
                    <CopyIconButton text={badgeSnippet} label="Deploy badge Markdown" />
                  </div>
                  <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">
                    <code>{badgeSnippet}</code>
                  </pre>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <Link
                  to="/templates"
                  className="underline-offset-4 hover:text-foreground hover:underline"
                >
                  Browse all Gregale templates
                </Link>
                <Link
                  to="/docs/$slug"
                  params={{ slug: 'deploy-button' }}
                  className="underline-offset-4 hover:text-foreground hover:underline"
                >
                  Button docs &amp; options
                </Link>
                <a
                  href={`https://github.com/gregale-dev/community/discussions`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
                >
                  Community Q&amp;A
                  <ArrowUpRight aria-hidden="true" className="size-3.5" />
                </a>
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-border bg-card p-6">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Paste any public GitHub repository URL or{' '}
                <span className="font-mono text-foreground">owner/repo</span> slug to generate a
                one-click deploy flow and Markdown badge.
              </p>
              {search.repo && (
                <p className="mt-3 text-sm text-destructive" role="alert">
                  “{search.repo}” is not a valid GitHub repository URL or owner/repo slug.
                </p>
              )}
              <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row">
                <label htmlFor="deploy-repo-input" className="sr-only">
                  GitHub repository URL or owner/repo
                </label>
                <Input
                  id="deploy-repo-input"
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    if (formError) setFormError(null);
                  }}
                  placeholder="https://github.com/gregale-dev/nextjs-postgres-starter"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-sm"
                />
                <Button type="submit" variant="cta" className="shrink-0">
                  Continue
                  <ArrowRight aria-hidden="true" className="ml-1.5 size-4" />
                </Button>
              </form>
              {formError && (
                <p className="mt-2 text-sm text-destructive" role="alert">
                  {formError}
                </p>
              )}
              <div className="mt-6 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <span>
                  Looking for a prebuilt starter?{' '}
                  <Link
                    to="/templates"
                    className="font-medium text-brand underline-offset-4 hover:underline"
                  >
                    Browse Gregale templates &amp; starters
                  </Link>
                </span>
                <Link
                  to="/docs/$slug"
                  params={{ slug: 'deploy-button' }}
                  className="underline-offset-4 hover:text-foreground hover:underline"
                >
                  Button docs &amp; options
                </Link>
              </div>
            </div>
          )}
        </main>
        <Footer />
      </div>
    </MotionConfig>
  );
}
