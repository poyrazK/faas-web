import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { LogDrain } from '@/lib/api/log-drains';
import {
  LogDrainFields,
  createBody,
  draftErrors,
  draftFrom,
  emptyDraft,
  kindLabel,
  updateBody,
  type LogDrainDraft,
} from './log-drain-form';

const http: LogDrain = {
  id: 'ld-1',
  app_id: 'app-1',
  account_id: 'acct',
  kind: 'http_json',
  target_url: 'https://logs.example.com/ingest',
  auth_header_masked: '***',
  enabled: true,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};
const datadog: LogDrain = {
  ...http,
  kind: 'datadog',
  target_url: 'https://http-intake.logs.datadoghq.eu/api/v2/logs',
};

describe('log drain drafts', () => {
  it('builds a Datadog create body from the site and key, never a typed URL', () => {
    const draft = { ...emptyDraft(), kind: 'datadog', site: 'us5', apiKey: 'k1' } as const;
    expect(draftErrors(draft)).toEqual({});
    expect(createBody(draft)).toEqual({
      kind: 'datadog',
      target_url: 'https://http-intake.logs.us5.datadoghq.com/api/v2/logs',
      auth_header: 'DD-API-KEY: k1',
      enabled: true,
    });
  });

  it('requires a Datadog API key on create and refuses one with a colon or space', () => {
    const draft: LogDrainDraft = { ...emptyDraft(), kind: 'datadog' };
    expect(draftErrors(draft).apiKey).toBe('Enter your Datadog API key.');
    expect(draftErrors({ ...draft, apiKey: 'a:b' }).apiKey).toMatch(/no spaces or colons/);
  });

  it('refuses an auth header apid would reject: one Name: value pair', () => {
    const draft: LogDrainDraft = { ...emptyDraft(), url: 'https://x.example.com' };
    expect(draftErrors({ ...draft, auth: 'Authorization: Bearer a' })).toEqual({});
    expect(draftErrors({ ...draft, auth: 'Bearer a' }).auth).toBeDefined();
    expect(draftErrors({ ...draft, auth: 'X-Key: a:b' }).auth).toBeDefined();
  });

  it('starts an edit from the stored drain with every secret empty', () => {
    expect(draftFrom(datadog)).toMatchObject({ kind: 'datadog', site: 'eu1', apiKey: '' });
    expect(draftFrom(http)).toMatchObject({ url: http.target_url, auth: '', clearAuth: false });
  });

  it('sends only what changed, and leaves a stored secret alone when the field is empty', () => {
    expect(updateBody(draftFrom(http), http)).toEqual({});
    expect(updateBody({ ...draftFrom(http), url: 'https://new.example.com' }, http)).toEqual({
      target_url: 'https://new.example.com',
    });
    expect(updateBody({ ...draftFrom(http), auth: 'X-Key: v' }, http)).toEqual({
      auth_header: 'X-Key: v',
    });
    expect(updateBody({ ...draftFrom(http), clearAuth: true }, http)).toEqual({ auth_header: '' });
    expect(updateBody({ ...draftFrom(datadog), site: 'us1' }, datadog)).toEqual({
      target_url: 'https://http-intake.logs.datadoghq.com/api/v2/logs',
    });
  });

  it('keeps an existing Datadog key optional but requires one when switching to Datadog', () => {
    expect(draftErrors(draftFrom(datadog), datadog)).toEqual({});
    expect(draftErrors({ ...draftFrom(http), kind: 'datadog' }, http).apiKey).toBeDefined();
  });

  it('removes the Datadog key when a drain leaves Datadog, so it is never sent elsewhere', () => {
    const draft = { ...draftFrom(datadog), kind: 'otlp', url: 'https://otel.example.com' } as const;
    expect(updateBody(draft, datadog)).toEqual({
      kind: 'otlp',
      target_url: 'https://otel.example.com',
      auth_header: '',
    });
  });

  it('names a Datadog drain by its site', () => {
    expect(kindLabel(datadog)).toBe('Datadog · eu1');
    expect(kindLabel(http)).toBe('HTTP (JSON lines)');
  });
});

function Harness({ existing, kinds }: { existing?: LogDrain; kinds: LogDrain['kind'][] }) {
  const [draft, setDraft] = useState(existing ? draftFrom(existing) : emptyDraft());
  return (
    <LogDrainFields
      draft={draft}
      onChange={setDraft}
      kinds={kinds}
      existing={existing}
      attempted={false}
    />
  );
}

describe('LogDrainFields', () => {
  it('swaps the URL and header for a site picker and a masked API key under Datadog', async () => {
    render(<Harness kinds={['http_json', 'otlp', 'datadog']} />);
    expect(screen.getByLabelText('Endpoint URL')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Format'), 'datadog');
    expect(screen.queryByLabelText('Endpoint URL')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Datadog site')).toHaveValue('us1');
    expect(screen.getByLabelText('Datadog API key')).toHaveAttribute('type', 'password');
    expect(
      screen.getByText('https://http-intake.logs.datadoghq.com/api/v2/logs')
    ).toBeInTheDocument();
  });

  it('does not offer Datadog unless it is one of the kinds', () => {
    render(<Harness kinds={['http_json', 'otlp']} />);
    expect(screen.queryByRole('option', { name: /Datadog/ })).not.toBeInTheDocument();
  });

  it('says a stored header is kept, and offers to remove it', () => {
    render(<Harness existing={http} kinds={['http_json', 'otlp']} />);
    expect(screen.getByText(/Leave empty to keep the current header/)).toBeInTheDocument();
    expect(screen.getByLabelText('Auth header (optional)')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Auth header (optional)')).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: 'Remove the auth header' })).toBeInTheDocument();
  });

  it("keeps a Datadog drain's own kind selectable when Datadog is off for new drains", () => {
    render(<Harness existing={datadog} kinds={['http_json', 'otlp']} />);
    expect(screen.getByLabelText('Format')).toHaveValue('datadog');
    expect(screen.getByText(/Leave empty to keep the current key/)).toBeInTheDocument();
  });
});
