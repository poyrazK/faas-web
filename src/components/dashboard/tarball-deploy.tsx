import { useRef, useState } from 'react';
import { Upload } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useDeployTarball } from '@/lib/api/queries';
import { cn } from '@/lib/utils';

/**
 * Deploy a source tarball the customer already has — the console's half of
 * `gregale deploy --tarball`, for code that is not in a connected repository.
 *
 * The annotations the API accepts alongside the archive (ADR-116) travel in
 * the `sidecar` part: a reason, one of the closed set of tags, and a PR
 * number. They are what makes a deploy auditable later, so they are offered
 * here rather than left to the CLI.
 */

const TAGS = [
  { value: '', label: 'No tag' },
  { value: 'incident_recovery', label: 'Incident recovery' },
  { value: 'hotfix', label: 'Hotfix' },
  { value: 'scheduled_maintenance', label: 'Scheduled maintenance' },
  { value: 'compliance_hold', label: 'Compliance hold' },
  { value: 'partner_request', label: 'Partner request' },
] as const;

type Tag = (typeof TAGS)[number]['value'];

export function TarballDeploy({
  slug,
  onDeployed,
}: {
  slug: string;
  onDeployed?: (deploymentId: string) => void;
}) {
  const { toast } = useToast();
  const deploy = useDeployTarball(slug);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState('');
  const [tag, setTag] = useState<Tag>('');

  const submit = async () => {
    if (!file) return;
    try {
      const deployment = await deploy.mutateAsync({
        file,
        sidecar: {
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          ...(tag ? { tag } : {}),
        },
      });
      setFile(null);
      setReason('');
      setTag('');
      if (inputRef.current) inputRef.current.value = '';
      toast({
        kind: 'success',
        title: 'Build accepted',
        description: `The archive is queued as deployment ${deployment.id.slice(0, 8)}.`,
      });
      onDeployed?.(deployment.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'source_too_large') {
        toast({
          kind: 'error',
          title: 'Archive too large',
          description: errorMessage(err),
        });
        return;
      }
      toast({
        kind: 'error',
        title: 'Could not deploy the archive',
        description: errorMessage(err),
      });
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (file && !deploy.isPending) void submit();
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Source archive</span>
        <input
          ref={inputRef}
          type="file"
          accept=".tar,.tar.gz,.tgz,application/gzip,application/x-tar"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          aria-label="Source tarball"
          className={cn(
            FIELD,
            'h-auto w-full py-2 text-xs file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs'
          )}
        />
        <span className="text-xs text-muted-foreground">
          A gzipped tar of the project, the same archive the CLI would build and send.
        </span>
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            Reason (recorded with the deployment)
          </span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Restoring the build that predates the outage"
            aria-label="Deploy reason"
            className={cn(FIELD, 'w-full')}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Tag</span>
          <Select
            value={tag}
            onChange={(e) => setTag(e.target.value as Tag)}
            aria-label="Deploy tag"
          >
            {TAGS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </label>
        <Button
          type="submit"
          size="sm"
          className="gap-1.5"
          disabled={!file}
          busy={deploy.isPending}
        >
          <Upload className="h-3.5 w-3.5" />
          Deploy archive
        </Button>
      </div>
    </form>
  );
}
