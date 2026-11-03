import { useCapabilityAccess } from '@/lib/api/capabilities';

/**
 * The stack snapshot Gregale took while a request stayed in flight for 10
 * seconds (`profile_capture_id` on the request, a `slow_request` capture;
 * faas docs/profiling.md "Stack snapshots for slow and stuck requests"). The
 * link opens it on the Profile captures tab, so it shows only while that
 * preview is on; otherwise the id is all there is to give.
 */
export function RequestCaptureLink({ slug, captureId }: { slug: string; captureId?: string }) {
  const { access } = useCapabilityAccess('profile-captures');
  if (!captureId) return null;
  return (
    <p className="text-xs">
      {access === 'on' ? (
        <a
          className="text-brand underline underline-offset-2"
          href={`/dashboard/apps/${encodeURIComponent(slug)}?${new URLSearchParams({ tab: 'Profile captures', capture: captureId })}`}
        >
          Open the stack snapshot taken while this request was in flight
        </a>
      ) : (
        <span className="text-muted-foreground">
          A stack snapshot was taken while this request was in flight (capture{' '}
          <code className="font-mono">{captureId}</code>).
        </span>
      )}
    </p>
  );
}
