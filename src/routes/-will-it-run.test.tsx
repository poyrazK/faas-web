import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';
import { MIN_TRANSITION_MS, Route as WillItRun } from './will-it-run';

type Report = components['schemas']['PreflightReport'];

/**
 * The page holds the result behind the transition on purpose, so assertions on
 * a verdict have to outlast that hold. Derived from the constant rather than
 * hard-coded: a longer transition must not silently push the suite past
 * waitFor's 1000ms default and start flaking on a loaded runner.
 */
const settleTimeout = { timeout: MIN_TRANSITION_MS + 2000 };

const budgets: Report['plan_budgets'] = [
  {
    plan: 'hobby',
    ram_mb: 256,
    billed_ram_mb: 264,
    included_running_minutes: 11636,
    included_gb_hours: 50,
    price_millicents: 900_000,
    overage_millicents_per_gb_hour: 1_000,
  },
];

function reportWith(verdict: Report['verdict']): Report {
  return {
    source: { owner: 'gregale', repo: 'api' },
    commit_sha: '0123456789abcdef0123456789abcdef01234567',
    verdict,
    plan_budgets: budgets,
    checked_at: '2026-09-21T10:00:00Z',
  };
}

async function renderPage(search: string) {
  const root = createRootRoute({ component: Outlet });
  const route = createRoute({
    getParentRoute: () => root,
    path: 'will-it-run',
    component: WillItRun.options.component,
    validateSearch: WillItRun.options.validateSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [`/will-it-run${search}`] }),
  });
  await router.load();
  await act(async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  });
}

function mockReport(report: Report) {
  vi.spyOn(api, 'GET').mockImplementation(
    async () => ({ data: report, response: new Response(null, { status: 200 }) }) as never
  );
}

function mockProblem(code: string, status: number) {
  const body = { type: 'about:blank', title: 'Problem', status, code };
  vi.spyOn(api, 'GET').mockImplementation(
    async () =>
      ({
        error: body,
        response: new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/problem+json' },
        }),
      }) as never
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('will-it-run', () => {
  it('asks for a repository when nothing has been checked', async () => {
    await renderPage('');
    expect(screen.getByPlaceholderText('github.com/owner/repo')).toBeInTheDocument();
  });

  // The honest "no" is the feature: a blocker must name what stops the app and
  // what to do about it, not just refuse.
  it('names the blocker and its remedy when the app cannot run', async () => {
    mockReport(
      reportWith({
        level: 'red',
        profile: { framework: 'oci', port: 8080 },
        findings: [
          {
            code: 'durable_local_disk',
            level: 'red',
            title: 'Expects durable local disk',
            detail: 'The Dockerfile declares a VOLUME.',
            remedy: 'Move persistent state to object storage.',
            sources: ['Dockerfile'],
          },
        ],
      })
    );

    await renderPage('?source=gregale/api');

    await waitFor(() => {
      expect(screen.getByText("This won't run here.")).toBeInTheDocument();
    }, settleTimeout);
    expect(screen.getByText('Expects durable local disk')).toBeInTheDocument();
    expect(screen.getByText('Move persistent state to object storage.')).toBeInTheDocument();
    expect(screen.getByText('Dockerfile')).toBeInTheDocument();
  });

  // Cost is reported as what a plan includes, never as a guess at the app's
  // memory use, so the running-time allowance has to reach the page.
  it('reports each plan allowance as running time when the app runs', async () => {
    mockReport(
      reportWith({
        level: 'green',
        profile: { framework: 'express', start_command: 'npm run start', port: 3000 },
      })
    );

    await renderPage('?source=gregale/api');

    await waitFor(() => {
      expect(screen.getByText('This should run as it is.')).toBeInTheDocument();
    }, settleTimeout);
    expect(screen.getByText('npm run start')).toBeInTheDocument();
    // 11,636 included minutes is 194 hours of running time.
    expect(screen.getByText('194 h')).toBeInTheDocument();
  });

  // The verdict is held behind the transition on purpose. A cached answer
  // returns near-instantly, and without the floor the decode would flash and
  // vanish — which reads as a glitch rather than as a transition.
  it('holds the verdict behind the transition while checking', async () => {
    mockReport(reportWith({ level: 'green', profile: { framework: 'express' } }));

    await renderPage('?source=gregale/api');

    expect(screen.getByText(/Reading gregale\/api/)).toBeInTheDocument();
    expect(screen.queryByText('This should run as it is.')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('This should run as it is.')).toBeInTheDocument();
    }, settleTimeout);
    expect(screen.queryByText(/Reading gregale\/api/)).not.toBeInTheDocument();
  });

  // Errors are branched on the stable code, never the prose or the status.
  it('explains a private repository without claiming it does not exist', async () => {
    mockProblem('preflight_repo_not_found', 404);

    await renderPage('?source=gregale/private');

    await waitFor(() => {
      expect(screen.getByText(/may be private/i)).toBeInTheDocument();
    }, settleTimeout);
  });
});
