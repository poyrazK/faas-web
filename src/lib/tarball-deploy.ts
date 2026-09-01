import type { components } from '@/lib/api/schema';

export type TarballSidecar = components['schemas']['SourceTarballDeployRequest'];

export function isTarball(name: string): boolean {
  return /\.(tar\.gz|tgz)$/i.test(name);
}

/**
 * The multipart shape of POST /v1/apps/{slug}/deployments/source-tarball:
 * the archive under `tarball`, and the informational sidecar (repo/ref the
 * CLI would auto-capture, plus the ADR-116 annotations) as one JSON string.
 */
export function tarballForm(input: { file: File; sidecar: TarballSidecar }): FormData {
  const form = new FormData();
  form.append('tarball', input.file);
  form.append('sidecar', JSON.stringify(input.sidecar));
  return form;
}
