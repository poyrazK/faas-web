import { createFileRoute, Link } from '@tanstack/react-router';
import { PublicInfoPage } from '@/components/public-info-page';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/terms')({
  component: Terms,
  head: () =>
    pageHead({
      title: 'Terms of Service',
      description: 'Terms for using the Gregale website, console, API, and plugin.',
    }),
});

function Terms() {
  return (
    <PublicInfoPage
      eyebrow="Trust & safety"
      title="Terms of Service"
      intro="These terms describe use of the Gregale website, console, API, and Gregale plugin. Last updated October 4, 2026."
    >
      <section>
        <h2>The service</h2>
        <p>
          Gregale lets you deploy and operate applications from your own source code. Features and
          limits depend on the plan and current beta availability described in the{' '}
          <a href="/docs/plans">plan documentation</a>. The Gregale plugin provides an additional
          way to inspect apps and deployments and request deployment actions through your connected
          account.
        </p>
      </section>
      <section>
        <h2>Your account and access</h2>
        <p>
          Keep your sign-in credentials and API keys secure. You are responsible for actions made
          with your account or keys and for granting access only to people you authorize. Contact{' '}
          <a href="mailto:support@gregale.dev">support@gregale.dev</a> if you believe access has
          been compromised.
        </p>
      </section>
      <section>
        <h2>Your applications and content</h2>
        <p>
          You retain responsibility for the code, data, and services you deploy, including obtaining
          the rights needed to use them and meeting obligations to your own users. Do not use
          Gregale to violate the law, interfere with the platform or other users, or introduce
          malicious code. We may restrict activity that threatens security or service availability.
        </p>
      </section>
      <section>
        <h2>Deployments and beta features</h2>
        <p>
          Deployments, rollbacks, and configuration changes can affect live traffic. Review the
          target app and source or rollback destination before approving an action, including an
          action requested through the plugin. During beta, features may change and some may be
          unavailable. Keep backups of important code and data.
        </p>
      </section>
      <section>
        <h2>Plans and payment</h2>
        <p>
          The public beta currently starts on the Free plan and paid checkout is disabled. The{' '}
          <a href="/docs/plans">plan documentation</a> describes published quotas and catalog
          pricing. If paid billing becomes available, its applicable price and payment terms must be
          presented before a paid purchase.
        </p>
      </section>
      <section>
        <h2>Privacy and support</h2>
        <p>
          The <Link to="/privacy">privacy notice</Link> describes how information is handled. For
          questions about these terms or the service, visit <Link to="/support">Support</Link> or
          email <a href="mailto:support@gregale.dev">support@gregale.dev</a>.
        </p>
      </section>
      <section>
        <h2>Changes</h2>
        <p>
          These terms may change as Gregale evolves. The date above identifies the current version.
          Material changes affecting your use of the service should be communicated through the
          website or account channels.
        </p>
      </section>
    </PublicInfoPage>
  );
}
