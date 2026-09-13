import { useState } from 'react';
import { useCreateOrg, useDeleteOrg } from '@/lib/api/queries';
import { errorMessage } from '@/lib/api/errors';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { FIELD, FieldError, fieldErrorProps, useFormValidation } from '@/components/ui/field';
import { ActionDisclosure } from '@/components/ui/action-disclosure';
import { useToast } from '@/components/ui/toast';

export function CreateOrganization({ onCreated }: { onCreated: (slug: string) => void }) {
  const create = useCreateOrg();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const validation = useFormValidation<'slug' | 'name'>();
  const errors = {
    slug: /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(slug)
      ? undefined
      : 'Use 3–32 lowercase letters, numbers or dashes; start and end with a letter or number.',
    name:
      name.trim() && name.trim().length <= 256
        ? undefined
        : 'Enter an organization name of 1–256 characters.',
  };
  return (
    <ActionDisclosure
      action="Create organization"
      title="Create an organization"
      open={open}
      onOpenChange={(next) => {
        if (create.isPending) return;
        setOpen(next);
        setSlug('');
        setName('');
        create.reset();
        validation.resetValidation();
      }}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!validation.validate(errors, event.currentTarget) || create.isPending) return;
          void create
            .mutateAsync({ slug, name: name.trim() })
            .then((created) => {
              setOpen(false);
              onCreated(created.slug);
            })
            .catch(() => undefined);
        }}
      >
        <label className="flex flex-col gap-1.5">
          Slug
          <input
            autoFocus
            name="slug"
            className={FIELD}
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            {...fieldErrorProps(
              validation.submitAttempted ? errors.slug : undefined,
              'org-slug-error'
            )}
          />
        </label>
        {validation.submitAttempted && errors.slug && (
          <FieldError id="org-slug-error">{errors.slug}</FieldError>
        )}
        <label className="flex flex-col gap-1.5">
          Organization name
          <input
            name="name"
            className={FIELD}
            value={name}
            onChange={(event) => setName(event.target.value)}
            {...fieldErrorProps(
              validation.submitAttempted ? errors.name : undefined,
              'org-name-error'
            )}
          />
        </label>
        {validation.submitAttempted && errors.name && (
          <FieldError id="org-name-error">{errors.name}</FieldError>
        )}
        {create.error && <p role="alert">{errorMessage(create.error)}</p>}
        <Button type="submit" busy={create.isPending}>
          Create organization
        </Button>
      </form>
    </ActionDisclosure>
  );
}

export function DeleteOrganization({ slug, onDeleted }: { slug: string; onDeleted: () => void }) {
  const remove = useDeleteOrg();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const validation = useFormValidation<'confirmation'>();
  const error = typed === slug ? undefined : `Type ${slug} exactly to continue.`;
  const close = () => {
    if (remove.isPending) return;
    setOpen(false);
    setTyped('');
    remove.reset();
    validation.resetValidation();
  };
  return (
    <>
      <div className="rounded-xl border border-destructive/30 p-5">
        <p className="mb-3 text-sm">Mark this shared organization as pending deletion.</p>
        <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
          Delete organization
        </Button>
      </div>
      <Modal
        open={open}
        onClose={close}
        title={`Delete ${slug}?`}
        description="This marks the organization as pending deletion. This console has no organization restoration action; the API does not specify a recovery window. Your personal account is not deleted."
      >
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (
              !validation.validate({ confirmation: error }, event.currentTarget) ||
              remove.isPending
            )
              return;
            void remove
              .mutateAsync(slug)
              .then(() => {
                setOpen(false);
                toast({ kind: 'success', title: 'Organization marked for deletion' });
                onDeleted();
              })
              .catch(() => undefined);
          }}
        >
          <label className="flex flex-col gap-1.5">
            Type {slug} to confirm
            <input
              autoFocus
              name="confirmation"
              className={FIELD}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              {...fieldErrorProps(
                validation.submitAttempted ? error : undefined,
                'org-delete-error'
              )}
            />
          </label>
          {validation.submitAttempted && error && (
            <FieldError id="org-delete-error">{error}</FieldError>
          )}
          {remove.error && (
            <p role="alert" className="mt-3">
              {errorMessage(remove.error)}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={remove.isPending} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" busy={remove.isPending}>
              Confirm deletion
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
