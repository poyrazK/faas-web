import { createFileRoute, Link } from '@tanstack/react-router';
import { PublicInfoPage } from '@/components/public-info-page';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/support')({
  component: Support,
  head: () =>
    pageHead({
      title: 'Support',
      description: 'Contact Gregale support for account, deployment, and privacy help.',
    }),
});

function Support() {
  return (
    <PublicInfoPage
      eyebrow="Help"
      title="Support"
      intro="Need help with your Gregale account, deployment, or the Gregale plugin? Email us and include enough context to identify the problem."
    >
      <section>
        <h2>Contact us</h2>
        <p>
          Email <a href="mailto:support@gregale.dev">support@gregale.dev</a>. Include your account
          email, app slug, relevant deployment ID, and the time of the issue when available. Do not
          email API keys, passwords, or other secrets.
        </p>
      </section>
      <section>
        <h2>Service information</h2>
        <p>
          Check the <Link to="/status">status page</Link> for platform incidents and the{' '}
          <Link to="/docs">documentation</Link> for setup and deployment guidance.
        </p>
      </section>
      <section>
        <h2>Privacy requests</h2>
        <p>
          Use the same email address for questions about your data or requests to access, correct,
          export, or delete account information. See the <Link to="/privacy">privacy notice</Link>{' '}
          for details.
        </p>
      </section>
    </PublicInfoPage>
  );
}
