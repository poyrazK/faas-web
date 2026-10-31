import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import { ArrowRight } from 'iconoir-react';
import { CopyButton } from '@/components/docs/copy-button';
import { DOC_SECTIONS } from '@/lib/docs-manifest';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/docs/')({
  component: DocsIndex,
  head: () =>
    pageHead({
      title: 'Documentation',
      description:
        'Deploy your first Gregale app, connect a repository, and learn how to run, observe, and scale your backend.',
    }),
});

const FIRST_COMMANDS = 'npm install -g gregale\ngregale login';
const TASKS = [
  {
    slug: 'deploy-from-github',
    title: 'Bring your repository',
    detail: 'Deploy existing code or connect GitHub.',
  },
  {
    slug: 'custom-domains',
    title: 'Connect your domain',
    detail: 'Configure DNS and verify your app’s address.',
  },
  {
    slug: 'scale-to-zero',
    title: 'Understand app lifecycle',
    detail: 'What happens when an idle app wakes.',
  },
  {
    slug: 'plans',
    title: 'Check your limits',
    detail: 'Compute, deployed apps, and plan allowances.',
  },
];

export function DocsIndex() {
  useEffect(() => {
    if (!window.location.hash) window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);
  return (
    <div className="docs-home">
      <header className="docs-home-heading">
        <p>Gregale documentation</p>
        <h1>From your code to a running API.</h1>
        <p>Start with one deployment. Find the guides you need as your backend grows.</p>
      </header>
      <section className="docs-start" aria-labelledby="docs-start-title">
        <div>
          <span className="docs-beta">Hosting · Public beta</span>
          <h2 id="docs-start-title">Your first deployment</h2>
          <p>
            Install the CLI, deploy a starter API, and verify the live URL. A complete path,
            including what to check when something fails.
          </p>
          <Link to="/docs/$slug" params={{ slug: 'getting-started' }} className="docs-primary-link">
            Start the guide <ArrowRight width={18} aria-hidden="true" />
          </Link>
        </div>
        <div className="docs-start-terminal">
          <div>
            <span>Start in your terminal</span>
            <CopyButton text={FIRST_COMMANDS} label="Copy commands" />
          </div>
          <pre>
            <code>
              <span aria-hidden="true">$ </span>npm install -g gregale{'\n'}
              <span aria-hidden="true">$ </span>gregale login
            </code>
          </pre>
          <p>
            Then create a starter and deploy it.
            <br />
            The guide walks through each step.
          </p>
        </div>
      </section>
      <section aria-labelledby="docs-tasks-title">
        <div className="docs-section-heading">
          <h2 id="docs-tasks-title">What are you working on?</h2>
        </div>
        <ul className="docs-tasks">
          {TASKS.map((task) => (
            <li key={task.slug}>
              <Link to="/docs/$slug" params={{ slug: task.slug }}>
                <span>
                  <strong>{task.title}</strong>
                  <span>{task.detail}</span>
                </span>
                <ArrowRight width={18} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="docs-browse-title">
        <div className="docs-section-heading">
          <h2 id="docs-browse-title">Explore the documentation</h2>
          <span>Guides & reference</span>
        </div>
        <div className="docs-directory">
          {DOC_SECTIONS.map((section) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              <p>{section.blurb}</p>
              <ul>
                {section.entries.map((entry) => (
                  <li key={entry.slug}>
                    <Link to="/docs/$slug" params={{ slug: entry.slug }}>
                      {entry.title}
                      <ArrowRight width={14} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>
      <aside className="docs-help">
        <div>
          <h2>Stuck on a deployment?</h2>
          <p>Include the app name, deployment ID, and error message. Don’t send credentials.</p>
        </div>
        <a href="mailto:support@gregale.dev">
          Contact support <ArrowRight width={16} aria-hidden="true" />
        </a>
      </aside>
    </div>
  );
}
