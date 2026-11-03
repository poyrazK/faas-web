/** Fixtures for the workflow page tests, in the API's shapes. */

export const HOUR = 3_600_000;
export const iso = (offset: number) => new Date(Date.now() + offset).toISOString();

export function run(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    app_id: 'app-uuid',
    workflow_name: 'invoice-sync',
    status: 'succeeded',
    scheduled_for: iso(-2 * HOUR),
    created_at: iso(-2 * HOUR),
    updated_at: iso(-HOUR),
    started_at: iso(-2 * HOUR),
    finished_at: iso(-HOUR),
    resume_count: 0,
    deployment_id: 'dep-uuid',
    ...extra,
  };
}

export function diagnostics(id: string, extra: Record<string, unknown> = {}) {
  return {
    run_id: id,
    workflow_name: 'invoice-sync',
    status: 'failed',
    observed_at: iso(0),
    legacy_unpinned: false,
    state_reason: 'failed',
    due_age_seconds: 0,
    stale_lease: false,
    steps: [],
    resume: {
      eligible: false,
      expected_resume_count: 0,
      reopened_steps: [],
      preserved_steps: [],
      blockers: [],
    },
    ...extra,
  };
}
