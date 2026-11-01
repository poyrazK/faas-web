/*
 * Approval ids as the API issues them, apart from `environment-readiness.ts`:
 * the project route's `validateSearch` reads them, and `validateSearch` ships
 * in the entry chunk, so these must not import the API hooks.
 */

export function canonicalApprovalId(value: string): string | undefined {
  if (
    !/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(value)
  )
    return;
  const hex = value.replaceAll('-', '').toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const validApprovalId = (value: string) => Boolean(canonicalApprovalId(value));
