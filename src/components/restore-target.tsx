import { Link } from '@tanstack/react-router';
import { RESTORE_DOC_SLUG, RESTORE_TARGET } from '@/lib/platform-claims';

export function RestoreTarget() {
  return (
    <Link
      to="/docs/$slug"
      params={{ slug: RESTORE_DOC_SLUG }}
      className="text-brand underline underline-offset-4 hover:text-foreground"
    >
      {RESTORE_TARGET}
    </Link>
  );
}
