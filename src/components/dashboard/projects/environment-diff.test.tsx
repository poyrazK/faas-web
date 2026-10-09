import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { EnvironmentDiffView } from './environment-diff';
import { EnvironmentStateView } from './environment-state';
import type { EnvironmentDiff, EnvironmentState } from '@/lib/api/projects';
const config = {
  project_slug: 'shop',
  environment: 'staging',
  version: 2,
  config_hash: 'a'.repeat(64),
  values: { region: 'eu' },
};
const routes = {
  ownership: 'application' as const,
  only_allow_declared_routes: false,
  declared_routes: [],
};
const policies = { ownership: 'application' as const, rules: [] };
it('keeps unknown secret fingerprints and version drift distinct from equality', () => {
  const data: EnvironmentDiff = {
    project_slug: 'shop',
    from_environment: 'production',
    to_environment: 'staging',
    generated_at: '2026-10-09T10:00:00Z',
    configuration: {
      project_slug: 'shop',
      from_environment: 'production',
      to_environment: 'staging',
      from_version: 1,
      to_version: 2,
      from_hash: 'a'.repeat(64),
      to_hash: 'b'.repeat(64),
      changes: [],
    },
    shared_resources: [
      { kind: 'policies', ownership: 'application', note: 'Shared across environments' },
    ],
    workloads: [
      {
        workload_slug: 'api',
        workload_name: 'API',
        release: {
          kind: 'unchanged',
          before: { workload_slug: 'api', workload_name: 'API', status: 'not_deployed' },
          after: { workload_slug: 'api', workload_name: 'API', status: 'not_deployed' },
        },
        variables: [],
        bindings: [],
        domains: { kind: 'unchanged', before: [], after: [] },
        routes: { kind: 'unchanged', before: routes, after: routes },
        policies: { kind: 'unchanged', before: policies, after: policies },
        secrets: [
          { key: 'LEGACY', kind: 'unknown', before: { present: true }, after: { present: true } },
          {
            key: 'TOKEN',
            kind: 'version_drift',
            before: { present: true, value_hash: 'a'.repeat(16), version: 1 },
            after: { present: true, value_hash: 'a'.repeat(16), version: 2 },
          },
        ],
      },
    ],
  };
  render(<EnvironmentDiffView data={data} />);
  expect(screen.getByText('unknown', { exact: true })).toBeInTheDocument();
  expect(screen.getByText('version_drift', { exact: true })).toBeInTheDocument();
  expect(screen.getByText('Fingerprint unknown', { exact: false })).toBeInTheDocument();
  expect(screen.getByText('Shared across environments')).toBeInTheDocument();
  expect(screen.queryByText('Environments match')).not.toBeInTheDocument();
});
it('shows no published graph separately from a workload live release and safe metadata', () => {
  const data: EnvironmentState = {
    project_slug: 'shop',
    environment: 'staging',
    protected: false,
    generated_at: '2026-10-09T10:00:00Z',
    configuration: config,
    active_release_set: null,
    release_set_status: 'none',
    shared_resources: [],
    workloads: [
      {
        workload_slug: 'api',
        workload_name: 'API',
        release: {
          workload_slug: 'api',
          workload_name: 'API',
          status: 'live',
          deployment_id: 'dep-1',
          image_digest: 'sha256:abc',
        },
        variables: [{ key: 'REGION', value: 'eu' }],
        secrets: [
          {
            key: 'TOKEN',
            version: 2,
            managed_by: 'object_storage',
            binding_id: 'bucket-1',
            credential_generation: 3,
          },
        ],
        bindings: [
          {
            kind: 'object_storage',
            binding_id: 'bucket-1',
            secret_keys: ['TOKEN'],
            credential_generation: 3,
          },
        ],
        domains: [],
        routes,
        policies,
      },
    ],
  };
  render(<EnvironmentStateView data={data} />);
  expect(screen.getByText('No active release graph')).toBeInTheDocument();
  expect(screen.getByText('dep-1')).toBeInTheDocument();
  expect(screen.getByText('REGION')).toBeInTheDocument();
  expect(screen.getByText('eu')).toBeInTheDocument();
  expect(screen.getAllByText(/generation 3/).length).toBeGreaterThan(0);
  expect(screen.getByText(/Snapshot/)).toHaveTextContent('2026-10-09T10:00:00Z');
  expect(screen.queryByRole('button', { name: /promote|clone|save/i })).not.toBeInTheDocument();
});
