declare module 'virtual:api-reference' {
  import type { ApiGroup, ApiGroupSummary } from '@/lib/api-reference/build';

  /** Every group, without its operations: enough for the index and the nav. */
  export const groups: { id: string; title: string; description?: string; count: number }[];
  export function loadGroup(id: string): Promise<ApiGroup | null | undefined>;
  /** Every operation's method, path and summary, for searching across groups. */
  export function loadSearch(): Promise<ApiGroupSummary[]>;
}
