import { api, unwrap } from './client';
import { ApiError } from './errors';
import type { components } from './schema';

export type DeployOptions = components['schemas']['UploadDeployOptions'];
type Deployment = components['schemas']['DeploymentResponse'];

/** 32 lowercase hex characters, the shape apid requires for Deployment-Attempt-ID. */
function attemptId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const COMMIT_ATTEMPTS = 3;
/** Resumes from the server offset before an upload gives up on making progress. */
const MAX_RESUMES = 5;

/**
 * The console's half of `gregale deploy --tarball`, on the resumable upload
 * session that replaced the multipart route (deprecated upstream). Chunks go
 * at the server's chunk size; a 409 re-reads the server offset and resumes;
 * the commit carries one Deployment-Attempt-ID across retries, so a lost reply
 * is recovered (202) rather than deployed twice.
 */
export async function uploadTarball(input: {
  slug: string;
  file: Blob;
  options?: DeployOptions;
  onProgress?: (sent: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<Deployment> {
  const { slug, file, options, onProgress, signal } = input;
  const session = await unwrap(
    api.POST('/v1/uploads', {
      body: {
        app_slug: slug,
        total_size: file.size,
        sha256_hex: await sha256Hex(file),
        ...(options ? { deploy_options: options } : {}),
      },
      signal,
    })
  );
  let offset = 0;
  let resumes = 0;
  while (offset < file.size) {
    const chunk = file.slice(offset, offset + session.chunk_size);
    try {
      await unwrap(
        api.PATCH('/v1/uploads/{id}', {
          params: { path: { id: session.upload_id }, header: { 'Upload-Offset': offset } },
          body: chunk as never,
          bodySerializer: () => chunk,
          headers: { 'Content-Type': 'application/offset+octet-stream' },
          signal,
        })
      );
      offset += chunk.size;
    } catch (error) {
      // Resume from the server's offset when the chunk may not have landed: a
      // dropped connection, or upload_session_offset_conflict. apid records
      // bytes only after a whole chunk is read, so re-reading is safe. Any
      // other refusal (cancelled, committed, expired) is final.
      const resumable =
        !(error instanceof ApiError) || error.code === 'upload_session_offset_conflict';
      if (!resumable || ++resumes > MAX_RESUMES) throw error;
      const state = await unwrap(
        api.GET('/v1/uploads/{id}', { params: { path: { id: session.upload_id } }, signal })
      );
      offset = state.received_bytes;
    }
    onProgress?.(offset, file.size);
  }
  const attempt = attemptId();
  for (let i = 1; ; i++) {
    try {
      return await unwrap(
        api.POST('/v1/uploads/{id}/commit', {
          params: { path: { id: session.upload_id }, header: { 'Deployment-Attempt-ID': attempt } },
          signal,
        })
      );
    } catch (error) {
      // Only a reply that never arrived is retried; an API refusal is final.
      if (error instanceof ApiError || i >= COMMIT_ATTEMPTS) throw error;
    }
  }
}
