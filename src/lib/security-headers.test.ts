import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders, type HeaderMode } from './security-headers';

const MODES: HeaderMode[] = ['production', 'preview', 'dev'];

/** The value of one directive, '' for a valueless directive, undefined when absent. */
function directive(csp: string, name: string): string | undefined {
  const entry = csp.split('; ').find((d) => d === name || d.startsWith(`${name} `));
  return entry === undefined ? undefined : entry.slice(name.length).trim();
}

function directives(csp: string): string[] {
  return csp.split('; ');
}

describe('production policy', () => {
  const csp = contentSecurityPolicy('production');

  it.each(['default-src', 'script-src', 'style-src', 'font-src', 'img-src'])(
    '%s names no third-party host, no hash or nonce',
    (name) => {
      const value = directive(csp, name);
      expect(value).toBeDefined();
      expect(value).not.toMatch(/https?:\/\//);
      expect(value).not.toMatch(/sha(256|384|512)-|nonce-/);
    }
  );

  it('connect-src allows exactly one third party: the S3 gateway signed uploads PUT to', () => {
    // `uploadSignedObject` (lib/api/object-storage.ts) PUTs the file straight to
    // the signed URL, which the API issues on the branded S3 gateway. Every
    // other request the console makes is same-origin.
    expect(directive(csp, 'connect-src')).toBe("'self' https://s3.gregale.dev");
  });

  it.each(['default-src', 'script-src', 'connect-src', 'font-src', 'img-src'])(
    '%s allows no unsafe keyword',
    (name) => {
      expect(directive(csp, name)).not.toMatch(/unsafe-/);
    }
  );

  it('styles alone keep unsafe-inline, for the prerendered style attributes', () => {
    expect(directive(csp, 'style-src')).toBe("'self' 'unsafe-inline'");
  });

  it('locks framing, plugins, base and forms', () => {
    expect(directive(csp, 'frame-ancestors')).toBe("'none'");
    expect(directive(csp, 'frame-src')).toBe("'none'");
    expect(directive(csp, 'object-src')).toBe("'none'");
    expect(directive(csp, 'base-uri')).toBe("'self'");
    expect(directive(csp, 'form-action')).toBe("'self' https://github.com");
    expect(directive(csp, 'upgrade-insecure-requests')).toBe('');
  });

  it('allows the data: QR code and blob: workers, nothing wider', () => {
    expect(directive(csp, 'img-src')).toBe("'self' data: blob:");
    expect(directive(csp, 'worker-src')).toBe("'self' blob:");
    expect(directive(csp, 'font-src')).toBe("'self'");
  });
});

describe('modes', () => {
  it('preview is production without upgrade-insecure-requests', () => {
    const production = directives(contentSecurityPolicy('production'));
    const preview = directives(contentSecurityPolicy('preview'));
    expect(production.filter((d) => d !== 'upgrade-insecure-requests')).toEqual(preview);
    expect(preview).not.toContain('upgrade-insecure-requests');
  });

  it('dev relaxes only inline script plus the HMR socket', () => {
    const dev = directives(contentSecurityPolicy('dev'));
    const preview = directives(contentSecurityPolicy('preview'));
    expect(dev.filter((d) => !preview.includes(d))).toEqual([
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self' https://s3.gregale.dev ws:",
    ]);
    expect(preview.filter((d) => !dev.includes(d))).toEqual([
      "script-src 'self'",
      "connect-src 'self' https://s3.gregale.dev",
    ]);
  });

  it.each(MODES)('%s carries the same static headers', (mode) => {
    const { 'Content-Security-Policy': csp, ...rest } = securityHeaders(mode);
    expect(csp).toBe(contentSecurityPolicy(mode));
    expect(rest).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Access-Control-Allow-Origin': 'https://gregale.dev',
    });
  });
});
