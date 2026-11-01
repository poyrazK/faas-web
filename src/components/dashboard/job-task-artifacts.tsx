import { Download } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { CopyIconButton } from '@/components/ui/copy-button';
import { useToast } from '@/components/ui/toast';
import {
  artifactsOf,
  isManagedArtifact,
  useJobArtifactDownload,
  type JobArtifact,
  type JobTask,
} from '@/lib/api/job-detail';
import { fetchSignedObject } from '@/lib/api/object-storage';
import { formatUsageBytes } from '@/lib/usage-format';

/**
 * The output artifacts a successful task published in its result manifest.
 *
 * Gregale keeps the manifest, not the bytes. An `obj://` artifact is in the
 * account's object storage, so apid can check it and sign a five-minute GET;
 * an `s3://` or `gs://` one is the customer's own reference and is only shown.
 * The signed URL is a bearer capability: it is fetched once, with no
 * credentials or referrer, and never displayed, copied or stored. The bytes
 * are saved under the artifact's name, because a presigned GET carries no
 * Content-Disposition and following it would render a text, JSON or HTML
 * artifact in place of the console.
 */
export function JobTaskArtifacts({
  name,
  runId,
  task,
}: {
  name: string;
  runId: string;
  task: JobTask;
}) {
  const artifacts = artifactsOf(task);
  const download = useJobArtifactDownload();
  const { toast } = useToast();
  if (artifacts.length === 0) return null;

  const onDownload = async (artifact: JobArtifact) => {
    try {
      const verified = await download.mutateAsync({
        name,
        runId,
        taskIndex: task.task_index,
        artifact: artifact.name,
      });
      const bytes = await fetchSignedObject(verified.download);
      const href = URL.createObjectURL(bytes);
      const link = document.createElement('a');
      link.href = href;
      link.download = artifact.name;
      link.click();
      // Revoked after the click has handed the blob to the download.
      setTimeout(() => URL.revokeObjectURL(href), 0);
      toast({
        kind: 'success',
        title: `Downloading ${artifact.name}`,
        description:
          "Gregale verified it just now. Check the file's SHA-256 against the digest listed with it: the object can change after verification.",
      });
    } catch (error) {
      toast({ kind: 'error', title: `Could not download ${artifact.name}`, error });
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <p className="label-mono text-muted-foreground">Artifacts</p>
      <ul className="flex flex-col gap-1.5">
        {artifacts.map((artifact) => (
          <li
            key={artifact.name}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-2 py-1.5 text-xs"
          >
            <span className="font-mono">{artifact.name}</span>
            <span className="[font-variant-numeric:tabular-nums] text-muted-foreground">
              {formatUsageBytes(artifact.size_bytes)}
            </span>
            <span className="flex min-w-0 max-w-full items-center gap-1">
              <span
                className="min-w-0 truncate font-mono text-muted-foreground"
                title={artifact.sha256}
              >
                {artifact.sha256}
              </span>
              <CopyIconButton text={artifact.sha256} label={`digest of ${artifact.name}`} />
            </span>
            {isManagedArtifact(artifact) ? (
              <span className="ml-auto">
                <Button
                  size="xs"
                  variant="outline"
                  aria-label={`Download ${artifact.name}`}
                  busy={download.isPending && download.variables?.artifact === artifact.name}
                  disabled={download.isPending}
                  onClick={() => void onDownload(artifact)}
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </Button>
              </span>
            ) : (
              <span className="flex min-w-0 basis-full items-center gap-1 text-muted-foreground">
                <span className="shrink-0">Stored outside Gregale:</span>
                <span className="min-w-0 truncate font-mono" title={artifact.uri}>
                  {artifact.uri}
                </span>
                <CopyIconButton text={artifact.uri} label={`location of ${artifact.name}`} />
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
