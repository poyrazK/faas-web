export const RESOURCE_ID = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i;
export function resourceId(value: unknown): string | undefined {
  return typeof value === 'string' && RESOURCE_ID.test(value) ? value : undefined;
}
