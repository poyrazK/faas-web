import { describe, expect, it } from 'vitest';
import { draftFrom } from './app-configuration';
import type { components } from '@/lib/api/schema';

const app = {
  slug: 'hello',
  ram_mb: 256,
  max_concurrency: 2,
  min_instances: 0,
  autoscale_target_rps: 0,
} as unknown as components['schemas']['AppResponse'];

/**
 * The draft is what the form edits and what the PATCH is built from, so a
 * field the API defaults must default the same way here — otherwise a save
 * with nothing touched would still write a value.
 */
describe('draftFrom', () => {
  it('defaults the wire protocol to http1 when the API omits it', () => {
    expect(draftFrom(app).app_protocol).toBe('http1');
  });

  it('carries an explicit protocol through', () => {
    expect(draftFrom({ ...app, app_protocol: 'grpc' }).app_protocol).toBe('grpc');
  });
});
