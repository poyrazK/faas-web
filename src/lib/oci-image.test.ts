import { expect, it } from 'vitest';
import { isDigestPinnedImage, imageRequest } from './oci-image';
const digest = 'a'.repeat(64);
it.each(['ghcr.io/team/api', 'registry.example:5000/team/api', 'r/x'])(
  'accepts %s by digest',
  (repo) => {
    expect(isDigestPinnedImage(`${repo}@sha256:${digest}`)).toBe(true);
  }
);
it.each([
  'r/x:latest',
  `r/x@sha256:${'A'.repeat(64)}`,
  'r/x@sha256:abc',
  `r//x@sha256:${digest}`,
  `r/../x@sha256:${digest}`,
  `r/x@sha256:${digest}\n`,
  `https://r/x@sha256:${digest}`,
  `r/x:tag@sha256:${digest}`,
])('rejects %s', (ref) => {
  expect(isDigestPinnedImage(ref)).toBe(false);
});
it('does not invent readiness or port overrides', () => {
  expect(imageRequest(`r/x@sha256:${digest}`, '', '', false)).toEqual({
    image: `r/x@sha256:${digest}`,
  });
  expect(imageRequest(`r/x@sha256:${digest}`, '3000', '/ready', true)).toEqual({
    image: `r/x@sha256:${digest}`,
    overrides: { port: 3000, healthcheck: { path: '/ready' } },
    full_rootfs_allow_auto: true,
  });
});
it.each([
  ['0', ''],
  ['65536', ''],
  ['3000.5', ''],
  ['', 'ready'],
  ['', '/ready\n'],
])('rejects invalid overrides %s %s', (port, path) => {
  expect(() => imageRequest(`r/x@sha256:${digest}`, port, path, false)).toThrow();
});
