import { normalizeId } from '@/lib/ids';

interface AppRef {
  id: string;
  slug: string;
}

/**
 * The slug of the app a release belongs to. A deployment names only its app's
 * ID; `/v1/apps` lists the person's own apps and ignores the workspace, so an
 * organization app is found in the workspace inventory instead.
 */
export function resolveAppSlug(
  appId: string,
  personal: AppRef[] | undefined,
  org: AppRef[] | undefined
): string | undefined {
  const id = normalizeId(appId);
  const match = (apps?: AppRef[]) => apps?.find((app) => normalizeId(app.id) === id)?.slug;
  return match(personal) ?? match(org);
}
