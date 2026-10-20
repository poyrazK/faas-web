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

function Privacy() {
  return (
    <PublicInfoPage
      eyebrow="Trust & safety"
      title="Privacy notice"
      intro="This notice describes the information Gregale handles when you use the website, console, API, and Gregale plugin. Last updated October 4, 2026."
    >
      <section>
        <h2>Who to contact</h2>
        <p>
          Gregale is published by Poyraz Kucukarslan. For privacy questions and requests, email{' '}
          <a href="mailto:support@gregale.dev">support@gregale.dev</a>.
        </p>
      </section>
      <section>
        <h2>Information we handle</h2>
        <ul>
          <li>
            Account and sign-in details, such as an email address and information returned by a
            chosen sign-in provider.
          </li>
          <li>
            Projects and deployments, including connected repository details, source or bundles you
            submit, app settings, and deployment history.
          </li>
          <li>
            Operational information needed to run and secure the service, such as usage records,
            request metadata, and error or audit logs.
          </li>
          <li>Messages and information you send to support.</li>
          <li>
            If you connect the Gregale plugin, a Gregale API key and the account information needed
            to perform the actions you request. The plugin stores the key encrypted and lets you
            disconnect it.
          </li>
        </ul>
      </section>
      <section>
        <h2>How information is used</h2>
        <p>
          We use this information to sign you in, run and deploy your apps, respond to your
          requests, provide support, monitor reliability and abuse, and maintain service records. We
          use session and similar browser storage to keep sign-in and site features working; the
          website also uses analytics to understand site usage.
        </p>
      </section>
      <section>
        <h2>Other services and locations</h2>
        <p>
          Gregale relies on service providers for hosting, identity, email, and other operations.
          Connected GitHub repositories and optional sign-in providers involve those services as
          well. Provider processing can occur outside your country. The{' '}
          <Link to="/docs/$slug" params={{ slug: 'subprocessors' }}>
            sub-processor list
          </Link>{' '}
          gives more detail about providers and data regions.
        </p>
        <p>
          When you use the Gregale plugin in ChatGPT or Codex, your requests and tool results also
          pass through that product under its own privacy terms.
        </p>
      </section>
      <section>
        <h2>Retention and your choices</h2>
        <p>
          Information is retained for service operation, security, and applicable record-keeping
          needs; periods vary by data type. Account export and deletion are available through
          Gregale account tools. You can disconnect an API key from the plugin page. Contact{' '}
          <a href="mailto:support@gregale.dev">support@gregale.dev</a> to ask about access,
          correction, export, deletion, or another privacy concern. We will handle requests under
          applicable law.
        </p>
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
