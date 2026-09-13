import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import { ApiError } from '@/lib/api/errors';

const useAppOpenAPI = vi.fn();
const useDeploymentOpenAPIDoc = vi.fn();
const useAppDeployments = vi.fn();
const useAppEdgeRules = vi.fn();
const dryRun = vi.fn();
const importDoc = vi.fn();
const remove = vi.fn();
const createRule = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useAppOpenAPI: (slug: string, source: string) => useAppOpenAPI(slug, source) as unknown,
  useDeploymentOpenAPIDoc: (slug: string, id: string) =>
    useDeploymentOpenAPIDoc(slug, id) as unknown,
  useAppDeployments: (slug: string) => useAppDeployments(slug) as unknown,
  useAppEdgeRules: (slug: string) => useAppEdgeRules(slug) as unknown,
  useDryRunAppOpenAPI: () => ({ mutateAsync: dryRun, isPending: false }),
  useImportAppOpenAPI: () => ({ mutateAsync: importDoc, isPending: false }),
  useDeleteAppOpenAPI: () => ({ mutateAsync: remove, isPending: false }),
  useCreateEdgeRule: () => ({ mutateAsync: createRule, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { OpenAPIImport, parseOpenAPIDocument } = await import('./openapi-import');

const ready = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });
const failed = (error: unknown) => ({ data: undefined, isPending: false, error, refetch: vi.fn() });
const notFound = () => failed(new ApiError({ status: 404, code: 'not_found', title: 'Not found' }));
const DOC = {
  openapi: '3.1.0',
  info: { title: 'api', version: '1.0.0' },
  paths: { '/orders': { get: {}, post: {} }, '/health': { get: {} } },
};
const dep = (id: string, status = 'live') => ({
  id,
  app_id: 'app1',
  image_digest: 'sha256:x',
  kind: 'github',
  status,
  created_at: '2026-09-06T10:00:00Z',
  rollback_on_5xx: false,
  first_5xx_count: 0,
});

beforeEach(() => {
  useAppOpenAPI
    .mockReset()
    .mockImplementation((_slug: string, source: string) =>
      source === 'manual_import' ? ready(DOC) : ready({ ...DOC, paths: { ...DOC.paths, '/x': {} } })
    );
  useDeploymentOpenAPIDoc.mockReset().mockReturnValue(ready(DOC));
  useAppDeployments
    .mockReset()
    .mockReturnValue(ready({ pages: [{ items: [dep('aaaaaaaa1111')] }] }));
  useAppEdgeRules.mockReset().mockReturnValue(ready([{ id: 'r1', priority: 30 }]));
  dryRun.mockReset().mockResolvedValue({
    openapi_version: '3.1.0',
    endpoint_count: 3,
    suggestions: [
      {
        path: '/orders',
        methods: ['get', 'post'],
        kind: 'validate',
        action: { schema: {}, validate_mode: 'observe' },
      },
    ],
  });
  importDoc.mockReset().mockResolvedValue({ endpoint_count: 3 });
  remove.mockReset().mockResolvedValue(undefined);
  createRule.mockReset().mockResolvedValue({});
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});

describe('parseOpenAPIDocument', () => {
  it('requires JSON with openapi, info and paths', () => {
    expect(parseOpenAPIDocument('').error).toMatch(/paste/i);
    expect(parseOpenAPIDocument('openapi: 3.1.0').error).toMatch(/not valid JSON/i);
    expect(parseOpenAPIDocument('{"openapi":"3.1.0"}').error).toMatch(/"info"/);
    expect(parseOpenAPIDocument(JSON.stringify(DOC)).doc).toBeDefined();
  });
});

describe('OpenAPIImport', () => {
  it('shows the imported document with its version and path count', () => {
    render(<OpenAPIImport slug="api" />);
    expect(screen.getByText('OpenAPI 3.1.0')).toBeInTheDocument();
    expect(screen.getByText('2 paths')).toBeInTheDocument();
  });

  it('reads a 404 on the import as nothing imported, not a fault', () => {
    useAppOpenAPI.mockImplementation(() => notFound());
    render(<OpenAPIImport slug="api" />);
    expect(screen.getByText(/no document has been imported/i)).toBeInTheDocument();
  });

  it('previews through dry-run before importing, then creates the ticked edge rules', async () => {
    render(<OpenAPIImport slug="api" />);
    await userEvent.type(
      screen.getByPlaceholderText(/"openapi"/),
      JSON.stringify(DOC).replace(/[{[]/g, '$&$&')
    );
    // userEvent treats `{` and `[` as key descriptors; the doubling above escapes them.
    await userEvent.click(screen.getByRole('button', { name: /^preview$/i }));
    await waitFor(() => expect(dryRun).toHaveBeenCalledWith(DOC));
    expect(importDoc).not.toHaveBeenCalled();
    expect(screen.getByText(/1 suggested edge rule/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: /import document and create 1 edge rule/i })
    );
    await waitFor(() => expect(importDoc).toHaveBeenCalledWith(DOC));
    await waitFor(() =>
      expect(createRule).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: 'api',
          match_path: '/orders',
          match_methods: ['GET', 'POST'],
          kind: 'validate',
          validate_mode: 'observe',
          priority: 40,
        })
      )
    );
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it('explains a 422 from the dry-run in the API’s terms', async () => {
    dryRun.mockRejectedValue(
      new ApiError({ status: 422, code: 'openapi_import_too_many_endpoints', title: 'Too many' })
    );
    render(<OpenAPIImport slug="api" />);
    await userEvent.type(
      screen.getByPlaceholderText(/"openapi"/),
      JSON.stringify(DOC).replace(/[{[]/g, '$&$&')
    );
    await userEvent.click(screen.getByRole('button', { name: /^preview$/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Too many endpoints' }));
  });

  it('renders the Free-plan 402 on the captured document as the plan panel', async () => {
    useDeploymentOpenAPIDoc.mockReturnValue(
      failed(
        new ApiError({
          status: 402,
          code: 'openapi_docs_not_allowed',
          title: 'Not on your plan',
          detail: 'endpoint discovery needs the Hobby plan or higher.',
        })
      )
    );
    render(withRouter(<OpenAPIImport slug="api" />));
    expect(await screen.findByText(/endpoint discovery needs the hobby plan/i)).toBeInTheDocument();
  });

  it('confirms before deleting the imported document', async () => {
    render(<OpenAPIImport slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }))
    );
    expect(remove).toHaveBeenCalled();
  });
});
