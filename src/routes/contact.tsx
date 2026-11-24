import { createFileRoute, Link } from '@tanstack/react-router';
import { Nav } from '@/components/landing/nav';
import { ContactSales } from '@/components/sales/contact-sales';
import { Button } from '@/components/ui/button';
import { featureFlags } from '@/lib/feature-flags';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/contact')({
  head: () =>
    pageHead({
      title: 'Talk to a founder',
      description:
        'Book a 20-minute call with a Gregale founder to discuss what you are building or see a demo.',
    }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main
        id="main"
        className="mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-36 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20 lg:pt-44"
      >
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand">
            A conversation, then a plan
          </p>
          <h1 className="mt-6 text-5xl font-medium leading-tight tracking-tight sm:text-6xl">
            Build your next
            <br />
            connection.
          </h1>
          <p className="mt-6 max-w-sm text-lg leading-relaxed text-muted-foreground">
            Tell us what your team needs. We can walk through deployment, scaling to zero, and how
            Gregale fits your application.
          </p>
          <ul className="mt-9 space-y-4 border-t border-border pt-7 text-sm text-muted-foreground">
            <li>01 — Discuss your application</li>
            <li>02 — Explore the platform together</li>
            <li>03 — Decide on the next step</li>
          </ul>
          <Link
            to="/docs"
            className="mt-9 inline-flex text-sm text-brand underline underline-offset-4"
          >
            Browse the technical docs →
          </Link>
        </div>
        <div className="space-y-6">
          <section className="rounded-2xl border border-border bg-card p-8">
            <h2 className="text-xl font-medium">Talk to a founder</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Pick a time for a 20-minute call on Google Meet.
            </p>
            <Button asChild variant="cta" className="mt-6">
              <a href="https://cal.com/poyrazk/talk-to-a-founder">Book on Cal.com</a>
            </Button>
          </section>
          {featureFlags.salesIntake && <ContactSales />}
        </div>
      </main>
    </div>
  );
}
