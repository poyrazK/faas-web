import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppEnvironment } from '@/lib/environment-scope';

const app = vi.hoisted(() => ({ current: null as unknown as AppEnvironment }));
vi.mock('@/lib/environment-scope', async (original) => ({
  ...(await original<typeof import('@/lib/environment-scope')>()),
  useAppEnvironment: () => app.current,
}));

const { EnvironmentValuesGate } = await import('./environment-values-gate');

const production: AppEnvironment = {
  scope: undefined,
  name: 'Production',
  kind: 'production',
  present: true,
  deployed: true,
  readOnly: false,
  failed: false,
  unavailable: false,
  retry: vi.fn(),
};
const staging = (over: Partial<AppEnvironment> = {}): AppEnvironment => ({
  scope: 'staging',
  name: 'Staging',
  kind: 'stage',
  present: true,
  deployed: true,
  readOnly: false,
  failed: false,
  unavailable: false,
  retry: vi.fn(),
  ...over,
});
const body = vi.fn((env: { scope?: string; readOnly: boolean }) => (
  <p data-testid="body">{JSON.stringify(env)}</p>
));
afterEach(() => body.mockClear());

it('leaves production exactly as it was: no note, no scope', () => {
  app.current = production;
  render(<EnvironmentValuesGate slug="api">{body}</EnvironmentValuesGate>);
  expect(screen.getByTestId('body')).toHaveTextContent('{"readOnly":false}');
  expect(screen.queryByRole('note')).toBeNull();
});

it('says it edits Staging and passes the scope on', () => {
  app.current = staging();
  render(<EnvironmentValuesGate slug="api">{body}</EnvironmentValuesGate>);
  expect(screen.getByRole('note')).toHaveTextContent(
    'Editing Staging. Production keeps its own values.'
  );
  expect(screen.getByTestId('body')).toHaveTextContent('"scope":"staging"');
});

it('shows how to deploy an app that is not in Staging, and mounts nothing that reads', () => {
  app.current = staging({ present: false });
  render(<EnvironmentValuesGate slug="api">{body}</EnvironmentValuesGate>);
  expect(screen.getByText(/api isn’t in Staging yet/)).toBeInTheDocument();
  expect(screen.getByText('gregale deploy --environment staging')).toBeInTheDocument();
  expect(body).not.toHaveBeenCalled();
});

it('waits, without reading, while it is unknown whether Staging has the app', () => {
  app.current = staging({ present: null });
  render(<EnvironmentValuesGate slug="api">{body}</EnvironmentValuesGate>);
  expect(screen.getByRole('status')).toHaveTextContent('Checking Staging…');
  expect(body).not.toHaveBeenCalled();
});

it('marks a protected stage read-only', () => {
  app.current = staging({ readOnly: true });
  render(<EnvironmentValuesGate slug="api">{body}</EnvironmentValuesGate>);
  expect(screen.getByRole('note')).toHaveTextContent(
    'Staging is protected: changes go through a promotion.'
  );
  expect(screen.getByTestId('body')).toHaveTextContent('"readOnly":true');
});

it('lets an app not yet deployed to Staging be set up, and says so', () => {
  app.current = staging({ deployed: false });
  render(<EnvironmentValuesGate slug="api">{body}</EnvironmentValuesGate>);
  expect(screen.getByRole('note')).toHaveTextContent(
    'Editing Staging. Production keeps its own values. api isn’t deployed there yet: these apply on its first deploy (gregale deploy --environment staging).'
  );
  expect(screen.getByTestId('body')).toHaveTextContent('"scope":"staging"');
});

it('offers a retry when Staging could not be read, instead of spinning', async () => {
  const retry = vi.fn();
  app.current = staging({ present: null, failed: true, retry });
  render(<EnvironmentValuesGate slug="api">{body}</EnvironmentValuesGate>);
  expect(screen.getByRole('alert')).toHaveTextContent('Staging could not be read.');
  screen.getByRole('button', { name: 'Try again' }).click();
  expect(retry).toHaveBeenCalled();
  expect(body).not.toHaveBeenCalled();
});

it('says when the project has no such environment', () => {
  app.current = staging({ name: 'Gone', scope: 'gone', present: null, unavailable: true });
  render(<EnvironmentValuesGate slug="api">{body}</EnvironmentValuesGate>);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Gone isn’t one of this project’s environments.'
  );
  expect(body).not.toHaveBeenCalled();
});
