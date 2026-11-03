import { useEffect, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/errors';
import { prepareSalesInquiry, submitSalesInquiry } from '@/lib/api/sales-intake';

const INPUT =
  'mt-2 block w-full rounded-lg border border-border bg-background px-3 py-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';
const bytes = (text: string) => new TextEncoder().encode(text).length;

export function ContactSales() {
  const [challenge, setChallenge] = useState('');
  const [ready, setReady] = useState(false);
  const [preparing, setPreparing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [checkAttempt, setCheckAttempt] = useState(0);
  function prepare() {
    setReady(false);
    setPreparing(true);
    setCheckAttempt((attempt) => attempt + 1);
  }
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const data = await prepareSalesInquiry();
        if (!active) return;
        setChallenge(data.challenge);
        timer = setTimeout(() => setReady(true), data.ready_after_ms);
      } catch {
        if (!active) return;
        setChallenge('');
        setError('The form is unavailable. Retry the form check in a moment.');
      } finally {
        if (active) setPreparing(false);
      }
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [checkAttempt]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !ready) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    const name = value('name');
    const email = value('email').toLowerCase();
    const company = value('company');
    const message = value('message');
    const salesperson_code = value('salesperson_code').toUpperCase();
    if (
      !name ||
      !message ||
      bytes(name) > 120 ||
      bytes(email) > 254 ||
      bytes(company) > 200 ||
      bytes(message) > 1500
    ) {
      setError(
        'Enter your name and message. Keep the message within 1500 bytes, name within 120, and company within 200.'
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      await submitSalesInquiry({
        name,
        email,
        company,
        message,
        salesperson_code,
        challenge,
        intent: value('intent') === 'demo' ? 'demo' : 'contact',
        website: value('website'),
      });
      setSent(true);
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'sales_challenge_invalid') {
        setError(
          'The form check expired. Your message is still here; submit again when the check is ready.'
        );
        void prepare();
      } else if (failure instanceof ApiError && failure.code === 'auth_rate_limited') {
        setError('Too many attempts. Wait one minute and try again.');
      } else {
        setError(
          failure instanceof ApiError
            ? failure.message
            : 'We could not confirm your request. Keep this page open and retry to avoid sending it twice.'
        );
      }
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <div role="status" className="rounded-2xl border border-border bg-card p-8 sm:p-12">
        <p className="font-mono text-xs uppercase tracking-widest text-brand">Message received</p>
        <h2 className="mt-4 text-3xl font-medium tracking-tight">Let’s start a conversation.</h2>
        <p className="mt-4 text-muted-foreground">
          The sales team will review your request and follow up using the email you provided.
        </p>
        <Link to="/docs" className="mt-8 inline-flex text-brand underline underline-offset-4">
          Explore the documentation →
        </Link>
      </div>
    );

  return (
    <form
      onSubmit={submit}
      className="relative rounded-2xl border border-border bg-card p-6 sm:p-9"
      aria-label="Contact sales"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="text-sm">
          Name
          <input className={INPUT} name="name" autoComplete="name" maxLength={120} required />
        </label>
        <label className="text-sm">
          Work email
          <input
            className={INPUT}
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
          />
        </label>
        <label className="text-sm">
          Company <span className="text-muted-foreground">(optional)</span>
          <input className={INPUT} name="company" autoComplete="organization" maxLength={200} />
        </label>
        <label className="text-sm">
          How can we help?
          <select className={INPUT} name="intent" defaultValue="demo">
            <option value="demo">Request a demo</option>
            <option value="contact">Talk to sales</option>
          </select>
        </label>
      </div>
      <label className="mt-5 block text-sm">
        What are you building?
        <textarea
          className={`${INPUT} min-h-32 resize-y`}
          name="message"
          rows={5}
          maxLength={1500}
          required
          placeholder="Tell us about your application, your team, and what you’d like to explore."
        />
      </label>
      <p className="mt-2 text-xs text-muted-foreground">
        Up to 1500 bytes. Please leave passwords and payment details out of your message.
      </p>
      <label className="mt-5 block text-sm">
        Salesperson code <span className="text-muted-foreground">(optional)</span>
        <input
          className={`${INPUT} max-w-52 uppercase tracking-widest`}
          name="salesperson_code"
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={6}
          pattern="[A-Za-z0-9]{6}"
          placeholder="e.g. POJU43"
        />
      </label>
      <p className="mt-2 text-xs text-muted-foreground">
        Already speaking with someone? Enter their six-character code.
      </p>
      <div aria-hidden="true" className="absolute -left-[10000px] top-0">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-5 text-sm text-status-serious">
          {error}
        </p>
      )}
      <div className="mt-7 flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={!ready || busy}>
          {busy ? 'Sending…' : 'Send request'}
        </Button>
        {!ready && (
          <span role="status" className="text-xs text-muted-foreground">
            {preparing || challenge ? 'Preparing form check…' : 'Form check unavailable.'}
          </span>
        )}
        {!preparing && !challenge && (
          <button
            type="button"
            className="text-sm text-brand underline"
            onClick={() => {
              setError('');
              void prepare();
            }}
          >
            Retry form check
          </button>
        )}
      </div>
      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
        We’ll use these details to respond to your inquiry. A salesperson code routes your message;
        enter a referral code separately when creating an account.
      </p>
    </form>
  );
}
