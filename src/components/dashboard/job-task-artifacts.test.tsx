import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { spyApi } from '@/test/api';
import type { JobTask } from '@/lib/api/job-detail';

const { JobTaskArtifacts } = await import('./job-task-artifacts');

const ok = (data: unknown) => Promise.resolve({ data, response: new Response() });
const problem = (status: number, code: string, detail: string) =>
  Promise.resolve({
    error: { type: 'about:blank', title: code, status, code, detail },
    response: new Response(null, { status }),
  });

const DIGEST = `sha256:${'ab'.repeat(32)}`;
const managed = {
  name: 'result',
  uri: 'obj://app-1/bucket-1/results/shard-a.parquet',
  size_bytes: 1_234_567,
  sha256: DIGEST,
};
const external = {
  name: 'mirror',
  uri: 's3://my-results/shard-a.parquet',
  size_bytes: 1234,
  sha256: DIGEST,
};
const task = (manifest?: unknown) =>
  ({
    run_id: 'run-1',
    task_index: 2,
    status: 'succeeded',
    attempt: 1,
    created_at: '2026-11-01T09:00:00Z',
    output_manifest: manifest,
  }) as JobTask;
const signed = (headers: Record<string, string> = {}) => ({
  name: 'result',
  size_bytes: 1_234_567,
  sha256: DIGEST,
  verified_at: '2026-11-01T10:00:00Z',
  download: {
    url: 'https://s3.gregale.dev/b/results/shard-a.parquet?X-Amz-Signature=secret',
    method: 'GET',
    headers,
    expires_at: '2026-11-01T10:05:00Z',
  },
});

function mount(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('JobTaskArtifacts', () => {
  it('renders nothing for a task that published no artifacts', () => {
    mount(<JobTaskArtifacts name="nightly-export" runId="run-1" task={task()} />);
    expect(screen.queryByText('Artifacts')).not.toBeInTheDocument();
  });

  it('lists each artifact with its size and expected digest', () => {
    mount(
      <JobTaskArtifacts
        name="nightly-export"
        runId="run-1"
        task={task({ version: 1, artifacts: [managed, external] })}
      />
    );
    expect(screen.getByText('result')).toBeInTheDocument();
    expect(screen.getByText('1.18 MiB')).toBeInTheDocument();
    expect(screen.getAllByText(/sha256:abab/)).toHaveLength(2);
  });

  it('offers a download only for Gregale-managed objects', () => {
    mount(
      <JobTaskArtifacts
        name="nightly-export"
        runId="run-1"
        task={task({ version: 1, artifacts: [managed, external] })}
      />
    );
    expect(screen.getByRole('button', { name: 'Download result' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download mirror' })).not.toBeInTheDocument();
    expect(screen.getByText('s3://my-results/shard-a.parquet')).toBeInTheDocument();
  });

  it('verifies, then fetches the bytes and saves them under the artifact name, never rendering the URL', async () => {
    const get = spyApi('GET').mockImplementation(() => ok(signed()));
    const fetch = vi.fn().mockResolvedValue(new Response('{"rows":1}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    URL.createObjectURL = vi.fn(() => 'blob:artifact');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mount(
      <JobTaskArtifacts
        name="nightly-export"
        runId="run-1"
        task={task({ version: 1, artifacts: [managed] })}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Download result' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(get).toHaveBeenCalledWith(
      '/v1/jobs/{name}/runs/{id}/tasks/{idx}/artifacts/{artifact}/download',
      { params: { path: { name: 'nightly-export', id: 'run-1', idx: 2, artifact: 'result' } } }
    );
    // The presigned GET has no Content-Disposition, so following it in this tab
    // would render a JSON or HTML artifact in place of the console.
    expect(fetch).toHaveBeenCalledWith(
      signed().download.url,
      expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' })
    );
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.href).toBe('blob:artifact');
    expect(link.download).toBe('result');
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:artifact'));
    expect(await screen.findByText(/check the file's sha-256/i)).toBeInTheDocument();
    // The URL is a bearer capability: it is fetched, never shown.
    expect(screen.queryByText(/X-Amz-Signature/)).not.toBeInTheDocument();
  });

  it('sends the headers the signed request names', async () => {
    spyApi('GET').mockImplementation(() => ok(signed({ 'x-amz-checksum-mode': 'ENABLED' })));
    const fetch = vi.fn().mockResolvedValue(new Response('x', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    URL.createObjectURL = vi.fn(() => 'blob:artifact');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mount(
      <JobTaskArtifacts
        name="nightly-export"
        runId="run-1"
        task={task({ version: 1, artifacts: [managed] })}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Download result' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const headers = new Headers((fetch.mock.calls[0]![1] as RequestInit).headers);
    expect(headers.get('x-amz-checksum-mode')).toBe('ENABLED');
  });

  it('says the storage host refused rather than saving its error page', async () => {
    spyApi('GET').mockImplementation(() => ok(signed()));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<Error/>', { status: 403 })));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mount(
      <JobTaskArtifacts
        name="nightly-export"
        runId="run-1"
        task={task({ version: 1, artifacts: [managed] })}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Download result' }));
    expect(await screen.findByText(/download failed \(403\)/i)).toBeInTheDocument();
    expect(click).not.toHaveBeenCalled();
  });

  it('says why apid refused, such as bytes that no longer match the manifest', async () => {
    spyApi('GET').mockImplementation(() =>
      problem(422, 'validation_failed', "the object bytes differ from the task's output manifest")
    );
    mount(
      <JobTaskArtifacts
        name="nightly-export"
        runId="run-1"
        task={task({ version: 1, artifacts: [managed] })}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Download result' }));
    expect(await screen.findByText(/object bytes differ/)).toBeInTheDocument();
  });
});
