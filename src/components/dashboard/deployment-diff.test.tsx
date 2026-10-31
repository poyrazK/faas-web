import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { ReleaseDiff } from '@/lib/api/deployment-detail';

const useReleaseDiff = vi.fn();
vi.mock('@/lib/api/deployment-detail', () => ({
  useReleaseDiff: (id: string) => useReleaseDiff(id) as unknown,
}));
const { DeploymentDiff } = await import('./deployment-diff');

const ready = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });

function diff(overrides: Partial<ReleaseDiff> = {}): ReleaseDiff {
  return {
    app: 'alpha',
    from: { deployment_id: 'dep-0', revision: 41, created_at: '2026-10-30T10:00:00Z' },
    to: { deployment_id: 'dep-1', revision: 42, created_at: '2026-10-31T10:00:00Z' },
    summary: 'new code, 2 config keys, 1 package',
    code: {
      changed: true,
      from_commit: 'aaaaaaa1111',
      to_commit: 'bbbbbbb2222',
      compare_url: 'https://github.com/acme/api/compare/aaaaaaa1111...bbbbbbb2222',
      image_changed: true,
    },
    config: {
      known: true,
      variables: [{ key: 'LOG_LEVEL', change: 'changed' }],
      secrets: [{ key: 'STRIPE_KEY', change: 'added' }],
    },
    dependencies: {
      known: true,
      added: [],
      removed: [],
      changed: [{ name: 'express', from: '4.18.2', to: '4.19.0' }],
    },
    runtime: [{ field: 'min_instances', from: '0', to: '1' }],
    database: {
      changed: true,
      from_release_command: 'npm run migrate',
      to_release_command: 'npm run migrate:v2',
    },
    ...overrides,
  };
}

describe('DeploymentDiff', () => {
  it('shows each section of what changed, by key and never by value', () => {
    useReleaseDiff.mockReturnValue(ready(diff()));
    render(<DeploymentDiff deploymentId="dep-1" />);
    const region = screen.getByRole('region', { name: 'What changed' });
    expect(region).toHaveTextContent('new code, 2 config keys, 1 package');
    expect(region).toHaveTextContent('v41');
    expect(region).toHaveTextContent('v42');
    expect(within(region).getByRole('link', { name: /compare on github/i })).toHaveAttribute(
      'href',
      'https://github.com/acme/api/compare/aaaaaaa1111...bbbbbbb2222'
    );
    expect(region).toHaveTextContent('LOG_LEVEL');
    expect(region).toHaveTextContent('STRIPE_KEY');
    expect(region).toHaveTextContent(/values are never shown/i);
    expect(region).toHaveTextContent('express');
    expect(region).toHaveTextContent('4.18.2');
    expect(region).toHaveTextContent('min_instances');
    expect(region).toHaveTextContent('npm run migrate:v2');
  });

  it('does not link a compare URL that is not GitHub over https', () => {
    useReleaseDiff.mockReturnValue(
      ready(
        diff({
          code: {
            changed: true,
            image_changed: false,
            compare_url: 'javascript:alert(1)',
          },
        })
      )
    );
    render(<DeploymentDiff deploymentId="dep-1" />);
    expect(screen.queryByRole('link', { name: /compare on github/i })).not.toBeInTheDocument();
  });

  it('says a section is unknown with the reason instead of claiming nothing changed', () => {
    useReleaseDiff.mockReturnValue(
      ready(
        diff({
          config: {
            known: false,
            note: 'the config history no longer reaches one of these releases',
            variables: [],
            secrets: [],
          },
          dependencies: {
            known: false,
            note: 'image releases have no build SBOM',
            added: [],
            removed: [],
            changed: [],
          },
        })
      )
    );
    render(<DeploymentDiff deploymentId="dep-1" />);
    expect(
      screen.getByText(/config history no longer reaches one of these releases/)
    ).toBeInTheDocument();
    expect(screen.getByText(/image releases have no build SBOM/)).toBeInTheDocument();
  });

  it('says a first release has nothing to compare with', () => {
    useReleaseDiff.mockReturnValue(
      ready(
        diff({
          from: undefined,
          summary: 'first release',
          config: {
            known: false,
            note: "this is the app's first release",
            variables: [],
            secrets: [],
          },
          runtime: [],
        })
      )
    );
    render(<DeploymentDiff deploymentId="dep-1" />);
    expect(screen.getByText(/nothing earlier to compare with/i)).toBeInTheDocument();
  });

  it('marks a truncated package list', () => {
    useReleaseDiff.mockReturnValue(
      ready(
        diff({
          dependencies: {
            known: true,
            added: [{ name: 'left-pad', to: '1.3.0' }],
            removed: [],
            changed: [],
            truncated: true,
          },
        })
      )
    );
    render(<DeploymentDiff deploymentId="dep-1" />);
    expect(screen.getByText(/at most 100 per list/i)).toBeInTheDocument();
  });

  it('keeps the read states apart', () => {
    useReleaseDiff.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({ status: 404, code: 'not_found', title: 'Not found', detail: 'gone' }),
      refetch: vi.fn(),
    });
    render(<DeploymentDiff deploymentId="dep-1" />);
    expect(screen.getByRole('alert')).toHaveTextContent('gone');
  });
});
