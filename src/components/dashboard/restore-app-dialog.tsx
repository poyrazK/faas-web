import { useId, useState } from 'react';
import { Undo } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD, FieldError, fieldErrorProps } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useRestoreApp } from '@/lib/api/queries';
import { cn } from '@/lib/utils';
import { appNameError } from './new-app-validation';

/**
 * What to tell someone whose restore was refused, by `ApiError.code`.
 *
 * The restore operation names `not_found` and `conflict` (an `expected_app_id`
 * mismatch only); apid also answers `app_not_restorable` (ADR-022), the plan
 * caps `plan_limit_apps` and `plan_limit_developer_apps`, `org_role_forbidden`,
 * and `billing_past_due`, which the spec does not list on this operation. An
 * unknown code falls through to the API's own sentence rather than a guess.
 */
export function restoreFailureMessage(err: unknown, slug: string): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'not_found':
        return `No deleted app named "${slug}" on this account. Check the spelling; an app deleted more than 7 days ago is permanently removed.`;
      case 'app_not_restorable':
        return `${slug} cannot be restored. Either its 7-day grace window has ended, or it was not deleted.`;
      case 'conflict':
        return `That app changed since you looked it up. Check Apps and try again.`;
      case 'mfa_required':
        return 'Set up multi-factor authentication in the prompt that opened, then restore again.';
      case 'plan_limit_apps':
        return 'Your account is at the number of apps allowed on your plan. Free a slot or change plan, then restore again.';
      case 'plan_limit_developer_apps':
        return 'Restoring this app would go over the developer environments your plan allows. Stop an unused one or change plan on the Plans page, then restore again.';
      case 'org_role_forbidden':
        return 'Your role in this organization does not allow restoring apps. Ask someone who manages the organization to restore it, or to change your role.';
      case 'billing_past_due':
        return 'Your account has an outstanding payment, so apps cannot be restored. Resolve billing on the Plans page, then restore again.';
    }
  }
  return errorMessage(err);
}

/**
 * Brings back an app deleted inside its 7-day grace window, by slug. There is
 * no listing of deleted apps to pick from, so the person types the slug.
 */
export function RestoreAppDialog({
  onClose,
  onRestored,
}: {
  onClose: () => void;
  /** Called with the restored app's slug after the API confirms. */
  onRestored: (slug: string) => void;
}) {
  const restore = useRestoreApp();
  const { toast } = useToast();
  const [slug, setSlug] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const pending = restore.isPending;
  const error = attempted ? appNameError(slug) : undefined;

  const submit = async () => {
    setAttempted(true);
    if (appNameError(slug) || pending) return;
    setFailure(null);
    try {
      const app = await restore.mutateAsync(slug);
      toast({
        kind: 'success',
        title: `${app.slug} restored`,
        description: 'It is back in your apps list with the settings it had when it was deleted.',
      });
      onRestored(app.slug);
      onClose();
    } catch (err) {
      setFailure(restoreFailureMessage(err, slug));
    }
  };

  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      title="Restore a deleted app"
      description="Enter the slug of an app you deleted in the last 7 days. After that window an app is permanently removed and cannot be restored."
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" busy={pending} onClick={() => void submit()}>
            {pending ? 'Restoring…' : 'Restore app'}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor={inputId} className="label-mono text-muted-foreground">
          App slug
        </label>
        <input
          id={inputId}
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setFailure(null);
          }}
          spellCheck={false}
          autoComplete="off"
          autoFocus
          placeholder="my-old-app"
          className={cn(FIELD, 'font-mono')}
          {...fieldErrorProps(error, errorId)}
        />
        {error && <FieldError id={errorId}>{error}</FieldError>}
        {failure && (
          <p role="alert" className="text-xs text-[color:var(--status-critical)]">
            {failure}
          </p>
        )}
      </form>
    </Modal>
  );
}

/** "Restore a deleted app" with its dialog; the Apps page header action. */
export function RestoreAppButton({ onRestored }: { onRestored: (slug: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Undo className="h-3.5 w-3.5" />
        Restore a deleted app
      </Button>
      {open && <RestoreAppDialog onClose={() => setOpen(false)} onRestored={onRestored} />}
    </>
  );
}
