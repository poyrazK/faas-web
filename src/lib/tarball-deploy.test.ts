import { describe, expect, it } from 'vitest';
import { isTarball, tarballForm } from './tarball-deploy';

/**
 * Two multipart parts, exactly as the CLI sends them: the archive under
 * `tarball`, and the informational sidecar as one JSON string. An empty
 * sidecar is still sent as `{}` so the server never sees a missing part.
 */
describe('tarballForm', () => {
  it('names the two parts and JSON-encodes the sidecar', () => {
    const file = new File(['gz'], 'app.tar.gz', { type: 'application/gzip' });
    const form = tarballForm({ file, sidecar: { reason: 'first deploy' } });
    expect(form.get('tarball')).toBe(file);
    expect(JSON.parse(form.get('sidecar') as string)).toEqual({ reason: 'first deploy' });
  });

  it('sends an empty sidecar as {}', () => {
    const file = new File(['gz'], 'app.tgz');
    expect(tarballForm({ file, sidecar: {} }).get('sidecar')).toBe('{}');
  });
});

describe('isTarball', () => {
  it('accepts .tar.gz and .tgz only', () => {
    expect(isTarball('app.tar.gz')).toBe(true);
    expect(isTarball('app.tgz')).toBe(true);
    expect(isTarball('app.zip')).toBe(false);
    expect(isTarball('app.tar')).toBe(false);
  });
});
