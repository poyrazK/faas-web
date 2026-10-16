import type { components } from './api/schema';
export type ImageRequest = components['schemas']['CreateDeploymentRequest'];
const IMAGE =
  /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*(:[0-9]+)?\/[A-Za-z0-9_./-]+@sha256:[0-9a-f]{64}$/;
/** Backend admission grammar plus obvious malformed path preflight. */
export function isDigestPinnedImage(reference: string): boolean {
  return (
    IMAGE.test(reference) &&
    reference
      .split('@')[0]
      .split('/')
      .slice(1)
      .every((part) => part !== '' && part !== '.' && part !== '..')
  );
}
/** Per-field preflight, so a form can put each complaint beside its field. */
export function imageReferenceError(image: string): string | undefined {
  if (!isDigestPinnedImage(image))
    return 'Use a repository@sha256: reference with a 64-character lowercase digest.';
}
export function portOverrideError(port: string): string | undefined {
  if (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535))
    return 'Port must be an integer from 1 to 65535.';
}
export function healthPathError(path: string): string | undefined {
  if (
    path &&
    (!path.startsWith('/') ||
      /\s/.test(path) ||
      Array.from(path).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      ))
  )
    return 'Health path must start with / and contain no whitespace.';
}
export function imageRequest(
  image: string,
  port: string,
  path: string,
  allowAuto: boolean
): ImageRequest {
  const problem = imageReferenceError(image) ?? portOverrideError(port) ?? healthPathError(path);
  if (problem) throw new Error(problem);
  return {
    image,
    ...(port || path
      ? {
          overrides: {
            ...(port ? { port: Number(port) } : {}),
            ...(path ? { healthcheck: { path } } : {}),
          },
        }
      : {}),
    ...(allowAuto ? { full_rootfs_allow_auto: true } : {}),
  };
}
