import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { isValidOrgSlug, slugFromName } from '@/lib/org-slug';
import type { components } from '@/lib/api/schema';

type Body = components['schemas']['CreateOrgRequest'];

const FIELD =
  'h-9 w-full rounded-md border border-border bg-background px-2 font-mono text-sm outline-none focus:border-brand/50';

/**
 * `gregale orgs create`: a slug (the URL) and a name (the label). The slug
 * follows the name until edited by hand; the creator becomes the first owner.
 */
export function CreateOrgDialog({
  open,
  onClose,
  onCreate,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (body: Body) => void;
  busy: boolean;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const valid = name.trim().length > 0 && isValidOrgSlug(slug);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New organisation"
      description="You become its first owner. Apps created inside it are billed to it."
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!valid}
            busy={busy}
            onClick={() => onCreate({ slug, name: name.trim() })}
          >
            Create organisation
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Name</span>
          <input
            aria-label="Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugFromName(e.target.value));
            }}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Slug</span>
          <input
            aria-label="Slug"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            className={FIELD}
          />
          {slug && !isValidOrgSlug(slug) && (
            <span className="text-xs" style={{ color: 'var(--status-critical)' }}>
              3–40 lowercase letters, digits and single hyphens.
            </span>
          )}
        </label>
      </div>
    </Modal>
  );
}
