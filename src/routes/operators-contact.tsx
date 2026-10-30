import { createFileRoute, Link } from '@tanstack/react-router';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/operators-contact')({
  head: () =>
    pageHead({
      title: 'Operators & Contact',
      description: 'Who operates Gregale, where we are based, and how to contact us.',
    }),
  component: OperatorsContactPage,
});

const LINK_CLASS =
  'rounded-sm text-brand underline decoration-brand/30 underline-offset-4 transition-colors hover:decoration-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring';

function OperatorsContactPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="border-b border-border px-6 sm:px-8">
        <div className="mx-auto flex h-20 max-w-3xl items-center justify-between gap-6">
          <Link
            to="/"
            aria-label="Gregale home"
            className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            <img src="/logo.png" alt="Gregale" className="h-7 w-auto" />
          </Link>
          <Link to="/docs" className={LINK_CLASS}>
            Documentation
          </Link>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-6 py-16 sm:px-8 sm:py-24">
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Operators &amp; Contact
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
          The people behind Gregale and how to reach us.
        </p>

        <section aria-labelledby="operators-heading" className="mt-12 border-t border-border pt-8">
          <h2 id="operators-heading" className="text-xl font-semibold">
            Who operates Gregale
          </h2>
          <p className="mt-4 max-w-xl leading-relaxed text-muted-foreground">
            Gregale is developed and operated by its two cofounders, based in Türkiye:
          </p>
          <ul className="mt-6 space-y-3 text-xl font-medium">
            <li>Hüseyin Poyraz Küçükarslan</li>
            <li>Bahadır Koşapınar</li>
          </ul>
          <p className="mt-6 leading-relaxed text-muted-foreground">
            Gregale is not currently an incorporated company.
          </p>
        </section>

        <section aria-labelledby="contact-heading" className="mt-10 border-t border-border pt-8">
          <h2 id="contact-heading" className="text-xl font-semibold">
            Contact us
          </h2>
          <p className="mt-4 max-w-xl leading-relaxed text-muted-foreground">
            For support, privacy requests, or legal enquiries, email us at:
          </p>
          <a
            href="mailto:support@gregale.dev"
            className={`${LINK_CLASS} mt-5 inline-block break-all text-xl font-medium`}
          >
            support@gregale.dev
          </a>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-6 sm:px-8">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4 text-sm">
          <p className="text-muted-foreground">© {new Date().getFullYear()} Gregale</p>
          <Link to="/" className={LINK_CLASS}>
            Back to home
          </Link>
        </div>
      </footer>
    </div>
  );
}
