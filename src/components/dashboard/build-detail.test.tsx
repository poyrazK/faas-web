import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildDetailPanel } from './build-detail';

const f = vi.hoisted(() => ({
  build: {} as Record<string, unknown>,
  sbom: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params = {},
  }: {
    children: unknown;
    to: string;
    params?: Record<string, string>;
  }) => (
    <a href={to.replace(/\$(\w+)/g, (_, key: string) => params[key] ?? '')}>{children as string}</a>
  ),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/api/queries', async (original) => ({
  ...(await original<object>()),
  useBuild: () => ({ data: f.build, isPending: false, error: null, refetch: vi.fn() }),
  useBuildProvenance: () => ({
    data: { commit_sha: 'abcdef0123456789', buildkit_version: 'v0.20' },
    isPending: false,
    error: null,
  }),
  useFetchBuildSbom: () => ({ mutateAsync: f.sbom, isPending: false }),
}));

beforeEach(() => {
  f.build = {
    id: 'build-only',
    deployment_id: '',
    kind: 'tarball',
    source_bytes: 4096,
    status: 'succeeded',
    duration_seconds: 0,
    enqueued_at: '2026-11-21T10:00:00Z',
  };
  f.sbom.mockReset().mockResolvedValue({ bomFormat: 'CycloneDX' });
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener() {}
      close() {}
    }
  );
});
afterEach(cleanup);

function open(section?: 'overview' | 'output' | 'provenance' | 'scans') {
  const onSectionChange = vi.fn();
  render(
    <BuildDetailPanel
      buildId="build-only"
      section={section}
      onSectionChange={onSectionChange}
      onClose={vi.fn()}
    />
  );
  return { onSectionChange };
}

describe('BuildDetailPanel', () => {
  it('shows a build with no release: its facts and that nothing is attached', () => {
    open();
    expect(screen.getByRole('dialog', { name: 'Build details' })).toBeInTheDocument();
    expect(screen.getByText('4.0 KB', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText(/No deployment is attached/)).toBeInTheDocument();
  });

  it('downloads the SBOM of a succeeded build', async () => {
    URL.createObjectURL = vi.fn().mockReturnValue('blob:sbom');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    open('provenance');
    await userEvent.click(screen.getByRole('button', { name: 'Download SBOM' }));
    expect(f.sbom).toHaveBeenCalledWith('build-only');
  });

  it('links a build that has a release to that release', () => {
    f.build = { ...f.build, deployment_id: 'dep-1' };
    open();
    expect(screen.getByRole('link', { name: 'Open its release' })).toHaveAttribute(
      'href',
      '/dashboard/releases/dep-1'
    );
  });

  it('turns a release-only section back to the overview', () => {
    const { onSectionChange } = open('scans');
    expect(onSectionChange).toHaveBeenCalledWith('overview', true);
  });
});
