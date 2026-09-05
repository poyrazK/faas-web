import { createFileRoute, redirect } from '@tanstack/react-router';
import { useSweepNavigate } from '@/components/sweep-link';
import { Button } from '@/components/ui/button';
import { AppQueryProvider } from '@/components/query-provider';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { useAcceptInvitation, useInvitation } from '@/lib/api/queries';
import { errorMessage } from '@/lib/api/errors';
import { readSession } from '@/lib/auth';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/invite/$token')({
  head: () => pageHead({ title: 'Invitation' }),
  // Accepting binds the signed-in account, so the invitee signs in first.
  beforeLoad: () => {
    if (!readSession()) throw redirect({ to: '/login' });
  },
  component: InvitePage,
});

/**
 * The landing page an invitation token deserves — the Team page mints
 * tokens, and until now the invitee had nowhere to take one. Peek shows
 * what is being joined before anything is consumed; Accept is one press.
 */
function InvitePage() {
  return (
    <AppQueryProvider>
      <ToastProvider>
        <InviteContent />
      </ToastProvider>
    </AppQueryProvider>
  );
}

function InviteContent() {
  const { token } = Route.useParams();
  const { toast } = useToast();
  const sweepNavigate = useSweepNavigate();
  const invitation = useInvitation(token);
  const accept = useAcceptInvitation();

  const inv = invitation.data;
  const expired = inv && inv.status !== 'pending';

  return (
    <div className="console flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-elevation-2">
        <img src="/logo-on-dark.png" alt="Gregale" className="h-7 w-auto" />

        {invitation.isPending ? (
          <p className="mt-6 text-sm text-muted-foreground">Reading the invitation…</p>
        ) : invitation.error || !inv ? (
          <>
            <h1 className="mt-6 text-xl font-semibold tracking-tight">
              This invitation is not valid
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {errorMessage(invitation.error)}. Ask the person who invited you to send a fresh token
              — they expire, and each one works once.
            </p>
          </>
        ) : expired ? (
          <>
            <h1 className="mt-6 text-xl font-semibold tracking-tight">
              This invitation was already {inv.status}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Ask for a new token if you still need access to{' '}
              <span className="font-mono text-foreground">{inv.org_slug}</span>.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-6 text-xl font-semibold tracking-tight">
              Join <span className="font-mono">{inv.org_slug}</span>
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              You were invited as <span className="text-foreground">{inv.role}</span>
              {inv.email ? (
                <>
                  {' '}
                  for <span className="font-mono text-foreground">{inv.email}</span>
                </>
              ) : null}
              . Expires {new Date(inv.expires_at).toLocaleDateString()}.
            </p>
            <Button
              className="mt-6 w-full"
              busy={accept.isPending}
              onClick={() =>
                void accept
                  .mutateAsync(token)
                  .then((member) => {
                    toast({
                      kind: 'success',
                      title: `Welcome to ${inv.org_slug}`,
                      description: `You joined as ${member.role}.`,
                    });
                    sweepNavigate('/dashboard');
                  })
                  .catch((err: unknown) =>
                    toast({
                      kind: 'error',
                      title: 'Could not accept',
                      description: errorMessage(err),
                    })
                  )
              }
            >
              Accept invitation
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
