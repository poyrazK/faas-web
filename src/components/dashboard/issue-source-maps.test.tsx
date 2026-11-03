import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Handlers } from '@/test/monetization';
import { parseManifest } from '@/lib/api/issue-trackers';
import { IssueSourceMaps, explainSourceMapError } from './issue-source-maps';
import { ApiError } from '@/lib/api/errors';

const NEW = 'aaaaaaaa-1111-4222-8333-444444444444';
const OLD = 'bbbbbbbb-1111-4222-8333-444444444444';
const SHA = 'a'.repeat(64);
const manifest = {
  version: 1,
  artifacts: [{ generatedFile: 'checkout-a1b2.js', sha256: SHA, payload: '{"version":3}' }],
};
const published = {
  deployment_id: OLD,
  manifest_sha256: 'f'.repeat(64),
  map_count: 4,
  ready: true,
  created_at: '2026-11-01T10:00:00Z',
};

let puts: unknown[];
let deletes: string[];
function api(extra: Handlers = {}) {
  return routeApi({
    'GET /v1/apps/{slug}/deployments': () => ({
      items: [
        { id: NEW, status: 'live', created_at: '2026-11-03T10:00:00Z' },
        { id: OLD, status: 'superseded', created_at: '2026-11-01T10:00:00Z' },
      ],
    }),
    'GET /v1/apps/{slug}/deployments/{deployment_id}/issue-source-maps': ({ params }) =>
      params?.path?.deployment_id === OLD
        ? published
        : problem(404, 'not_found', 'issue resource not found'),
    'PUT /v1/apps/{slug}/deployments/{deployment_id}/issue-source-maps': ({ body, params }) => {
      puts.push(body);
      return {
        deployment_id: params?.path?.deployment_id,
        manifest_sha256: 'c'.repeat(64),
        map_count: 1,
        ready: true,
        created_at: '2026-11-03T12:00:00Z',
      };
    },
    'DELETE /v1/apps/{slug}/deployments/{deployment_id}/issue-source-maps': ({ params }) => {
      deletes.push(String(params?.path?.deployment_id));
      return { ...published, ready: false, retired_at: '2026-11-03T12:00:00Z' };
    },
    ...extra,
  });
}

const file = (text: string, name = '.gregale-issue-maps.json') =>
  new File([text], name, { type: 'application/json' });

beforeEach(() => {
  puts = [];
  deletes = [];
});
afterEach(() => vi.restoreAllMocks());

describe('IssueSourceMaps', () => {
  it('says nothing is published, then publishes the chosen manifest and shows apid’s answer', async () => {
    api();
    renderWithProviders(<IssueSourceMaps accountId="acct" slug="shop" />);
    expect(await screen.findByText('Nothing published for this deployment.')).toBeInTheDocument();
    const input = screen.getByLabelText('Manifest file');
    await userEvent.upload(input, file(JSON.stringify(manifest)));
    expect(await screen.findByText(/1 map for checkout-a1b2.js/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Publish source maps' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ directory: '/app/dist', manifest });
    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(screen.getByTitle('c'.repeat(64))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish source maps' })).toBeNull();
  });

  it('refuses a file that is not a manifest before sending', async () => {
    api();
    renderWithProviders(<IssueSourceMaps accountId="acct" slug="shop" />);
    await screen.findByText('Nothing published for this deployment.');
    await userEvent.upload(screen.getByLabelText('Manifest file'), file('{"version":2}'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/version 1 source-map manifest/);
    expect(screen.getByRole('button', { name: 'Publish source maps' })).toBeDisabled();
  });

  it('explains an immutable manifest conflict from its code', async () => {
    api({
      'PUT /v1/apps/{slug}/deployments/{deployment_id}/issue-source-maps': () =>
        problem(409, 'issue_source_maps_conflict', 'immutable'),
    });
    renderWithProviders(<IssueSourceMaps accountId="acct" slug="shop" />);
    await screen.findByText('Nothing published for this deployment.');
    await userEvent.upload(screen.getByLabelText('Manifest file'), file(JSON.stringify(manifest)));
    await screen.findByText(/1 map for/);
    await userEvent.click(screen.getByRole('button', { name: 'Publish source maps' }));
    expect(await screen.findByText(/cannot be replaced, even after retiring/)).toBeInTheDocument();
  });

  it('reads another deployment and retires its maps after confirming', async () => {
    api();
    renderWithProviders(<IssueSourceMaps accountId="acct" slug="shop" />);
    await screen.findByText('Nothing published for this deployment.');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Deployment' }), OLD);
    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retire maps' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retire maps' }));
    await waitFor(() => expect(deletes).toEqual([OLD]));
    expect(await screen.findAllByText('Retired')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Restore the same manifest' })).toBeInTheDocument();
  });
});

describe('source map helpers', () => {
  it('accepts only a version 1 manifest of 1 to 32 hex-digested maps', () => {
    expect(parseManifest(JSON.stringify(manifest))).toEqual(manifest);
    expect(parseManifest('nope')).toMatch(/not JSON/);
    expect(parseManifest(JSON.stringify({ version: 1, artifacts: [] }))).toMatch(/1 to 32/);
    expect(
      parseManifest(
        JSON.stringify({ version: 1, artifacts: [{ ...manifest.artifacts[0], sha256: 'x' }] })
      )
    ).toMatch(/64-character hex/);
  });

  it('names the ready-set cap', () => {
    const quota = new ApiError({ status: 409, code: 'issue_quota_exceeded', title: 'q' });
    expect(explainSourceMapError(quota)).toMatch(/32 ready source-map sets/);
  });
});
