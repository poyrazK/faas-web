import { ApiError } from '@/lib/api/errors';

/**
 * What a storage refusal means for the change someone just tried, by the
 * stable code apid's `BucketProblem` maps every storage error to
 * (faas pkg/apid/object/storage.go:197). `conflict` is the action-specific
 * reading of `object_storage_conflict`, which apid uses for "busy" and for
 * "contradicts something else on the bucket" alike. Undefined means the API's
 * own sentence is the best description.
 */
export function storageRefusal(error: unknown, conflict?: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  switch (error.code) {
    case 'object_storage_conflict':
      return conflict ?? 'The bucket is busy with another change. Try again in a moment.';
    case 'object_storage_unsupported':
      return "This bucket's storage does not support this setting.";
    case 'object_storage_not_taggable':
      return 'This object version does not support tags.';
    case 'object_storage_invalid':
      return 'apid did not accept these values. Check them and try again.';
    case 'object_storage_unavailable':
      return 'Object storage is unavailable right now. Nothing was changed; try again later.';
    case 'object_storage_budget_reached':
      return 'The object storage safety budget is spent, so new storage requests are blocked.';
    case 'object_storage_usage_stale':
      return 'Storage accounting is catching up, so new storage requests are blocked for now.';
    default:
      return undefined;
  }
}
