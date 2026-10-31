import { createFileRoute, Link } from '@tanstack/react-router';
import { PublicInfoPage } from '@/components/public-info-page';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/privacy')({
  component: Privacy,
  head: () =>
    pageHead({
      title: 'Privacy',
      description: 'How Gregale handles account, deployment, and support information.',
    }),
});

/* Every fact on this page is sourced from the repositories, not written to
   sound complete: data categories and retention from the DPA
   (`content/docs/dpa.md`, vendored from poyrazK/faas `docs/DPA.md`), export
   and deletion from the console's Settings panels, analytics from
   `routes/__root.tsx`, agent connections from `content/docs/agents.md` and
   poyrazK/faas `docs/mcp.md`, and the operator name from poyrazK/faas
   `LICENSE`. The TODO(launch) comments mark what the repositories do not say
   and a publisher has to decide before this page ships. */
function Privacy() {
  return (
    <PublicInfoPage
      eyebrow="Trust & safety"
      title="Privacy notice"
      // TODO(launch): set to the date this text is published.
      intro="This notice describes the information Gregale handles when you use the website, console, API, CLI, and agent connections. Last updated October 31, 2026."
    >
      <section>
        <h2>Who to contact</h2>
        {/* TODO(launch): confirm who is the data controller. The name below is
            the copyright holder in poyrazK/faas LICENSE; PR #167 names two
            cofounders instead. Legal entity, address, and jurisdiction are not
            in the repositories — the DPA leaves {{JURISDICTION}} open. */}
        <p>
          Gregale is published by Hüseyin Poyraz Küçükarslan. For privacy questions and requests,
          email <a href="mailto:support@gregale.dev">support@gregale.dev</a>.
        </p>
      </section>
      <section>
        <h2>Information we handle</h2>
        <ul>
          <li>
            Account details: your email address, information returned by GitHub or Google if you
            sign in with them, your plan, and a billing-provider customer ID.
          </li>
          <li>
            Apps and deployments: connected repository details, the source or bundles you submit,
            build artifacts, app settings, environment variables and secrets (sealed at rest), and
            deployment history.
          </li>
          <li>
            Usage records for billing: per-minute aggregates of request count and memory time per
            app. Request and response bodies are not kept beyond the time it takes to serve them.
          </li>
          <li>
            Operational logs used to run and secure the service: request path, status code, IP
            address, and timing.
          </li>
          <li>
            Request analytics for your apps: aggregates over browser family, referring hostname,
            country, route, and status. These store no source IP, full User-Agent, full referrer
            URL, or cookies.
          </li>
          <li>Messages and information you send to support.</li>
          <li>
            If you connect an AI agent (for example ChatGPT or Claude) to Gregale, a connection
            credential labelled <code>mcp-login</code> and the apps and permissions you granted it.
          </li>
        </ul>
      </section>
      <section>
        <h2>How information is used</h2>
        <p>
          We use this information to sign you in, build, deploy, and run your apps, meter usage,
          send transactional email about your account, respond to your requests, monitor reliability
          and abuse, and keep service records. The site uses browser storage to keep you signed in
          and to remember console preferences. It also uses Vercel Web Analytics to understand site
          usage; it sets no cookies.
        </p>
        {/* TODO(launch): the legal bases for each use (GDPR Art. 6 / KVKK) are
            not stated anywhere in the repositories. */}
      </section>
      <section>
        <h2>Other services and locations</h2>
        <p>
          Gregale relies on service providers for databases, backups, email, sign-in, and billing.
          Connected GitHub repositories and GitHub or Google sign-in involve those services as well.
          Provider processing can occur outside your country. The{' '}
          <Link to="/docs/$slug" params={{ slug: 'subprocessors' }}>
            sub-processor list
          </Link>{' '}
          names each provider and what it does.
        </p>
        <p>
          When you use Gregale through an AI agent, your requests and the tool results pass through
          that product under its own privacy terms.
        </p>
      </section>
      <section>
        <h2>Retention and your choices</h2>
        <p>
          Operational logs are kept for 30 days for security incident response. Request analytics
          are kept for the period your plan sets. Tax invoices are kept for 7 years. Other
          information is kept while your account exists.
        </p>
        <p>
          In the console, Settings lets you download a JSON export of your account and schedule its
          deletion. Deletion takes effect after a 30-day recovery window, during which you can
          restore the account. Agent connections end after a week unused and 30 days after you
          connect at the latest, and you can revoke one from your API keys at any time.
        </p>
        <p>
          Contact <a href="mailto:support@gregale.dev">support@gregale.dev</a> to ask about access,
          correction, export, deletion, or another privacy concern.
        </p>
        {/* TODO(launch): how long requests take to answer, and which
            supervisory authority a user can complain to, depend on the
            jurisdiction above and are not in the repositories. */}
      </section>
      <section>
        <h2>Changes</h2>
        <p>
          We may update this notice as the service changes. The date above identifies the current
          version.
        </p>
      </section>
    </PublicInfoPage>
  );
}
