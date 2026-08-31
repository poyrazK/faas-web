import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DeployAnnotations } from '@/components/dashboard/deploy-annotations';
import { annotationsBody, EMPTY_ANNOTATIONS, type AnnotationDraft } from '@/lib/deploy-annotations';
import { isTarball, type TarballSidecar } from '@/lib/tarball-deploy';

/**
 * Upload a source archive and build it — the browser end of the CLI's
 * zero-config deploy. The archive is the repo root as `.tar.gz`; the
 * platform detects the runtime the same way it does for a git ref.
 */
export function TarballDeployForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (file: File, sidecar: TarballSidecar) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationDraft>(EMPTY_ANNOTATIONS);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (file) onSubmit(file, annotationsBody(annotations));
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Archive</span>
        <input
          aria-label="Archive"
          type="file"
          accept=".tar.gz,.tgz,application/gzip"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (f && !isTarball(f.name)) {
              setFile(null);
              setRejected(f.name);
            } else {
              setFile(f);
              setRejected(null);
            }
          }}
          className="text-sm"
        />
        {rejected && (
          <span className="text-xs text-[color:var(--status-critical)]">
            {rejected} was not accepted — only .tar.gz or .tgz archives build.
          </span>
        )}
      </label>
      <details>
        <summary className="cursor-pointer text-sm text-muted-foreground">
          Annotations (optional)
        </summary>
        <div className="mt-3">
          <DeployAnnotations value={annotations} onChange={setAnnotations} />
        </div>
      </details>
      <div>
        <Button type="submit" size="sm" disabled={!file} busy={busy}>
          Deploy archive
        </Button>
      </div>
    </form>
  );
}
