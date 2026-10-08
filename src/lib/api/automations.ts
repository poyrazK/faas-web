import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';

export type Automation = components['schemas']['AutomationResponse'];
export type Definition = components['schemas']['WorkflowSpec'];
export type AutomationStep = Definition['steps'][number];
export type AutomationRun = components['schemas']['WorkflowRunResponse'];
export type Simulation = components['schemas']['SimulateAutomationResponse'];
export type Validation = components['schemas']['ValidateAutomationResponse'];
export type Revision = components['schemas']['AutomationRevisionResponse'];

const root = (account: string, slug: string) => ['automations', account, slug] as const;

export function useAutomations(account: string, slug: string) {
  return useQuery({
    queryKey: [...root(account, slug), 'list'],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/automations', {
          params: { path: { slug } },
          signal,
        })
      ),
    enabled: Boolean(account && slug),
    refetchInterval: 30_000,
  });
}

export function useAutomationHealth(account: string, slug: string, name: string) {
  return useQuery({
    queryKey: [...root(account, slug), name, 'health'],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/automations/{name}/health', {
          params: { path: { slug, name } },
          signal,
        })
      ),
    enabled: Boolean(account && slug && name),
    refetchInterval: 30_000,
  });
}

export function useAutomationRuns(account: string, slug: string, name: string, offset: number) {
  return useQuery({
    queryKey: [...root(account, slug), name, 'runs', offset],
    queryFn: async ({ signal }) => {
      const data = await unwrap(
        api.GET('/v1/apps/{slug}/workflows/runs', {
          params: { path: { slug }, query: { workflow_name: name, limit: 25, offset } },
          signal,
        })
      );
      // The list only needs metadata. Payloads are fetched on explicit detail selection.
      return { ...data, runs: data.runs.map(({ input: _input, output: _output, ...run }) => run) };
    },
    enabled: Boolean(account && slug && name),
    refetchInterval: 10_000,
  });
}

export function useAutomationRun(account: string, slug: string, id: string) {
  return useQuery({
    queryKey: [...root(account, slug), 'run', id],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/workflows/runs/{id}', {
          params: { path: { id } },
          signal,
        })
      ),
    enabled: Boolean(account && slug && id),
    refetchInterval: 5_000,
    gcTime: 0,
  });
}

export function useAutomationSteps(account: string, slug: string, id: string) {
  return useQuery({
    queryKey: [...root(account, slug), 'run', id, 'steps'],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/workflows/runs/{id}/steps', {
          params: { path: { id } },
          signal,
        })
      ),
    enabled: Boolean(account && slug && id),
    refetchInterval: 5_000,
    gcTime: 0,
  });
}

export function useAutomationAttempts(account: string, slug: string, id: string, step: string) {
  return useQuery({
    queryKey: [...root(account, slug), 'run', id, 'attempts', step],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/workflows/runs/{id}/steps/{step}/attempts', {
          params: { path: { id, step } },
          signal,
        })
      ),
    enabled: Boolean(account && slug && id && step),
    refetchInterval: 5_000,
    gcTime: 0,
  });
}

export function useAutomationRevisions(
  account: string,
  slug: string,
  name: string,
  offset: number
) {
  return useQuery({
    queryKey: [...root(account, slug), name, 'revisions', offset],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/automations/{name}/revisions', {
          params: { path: { slug, name }, query: { limit: 25, offset } },
          signal,
        })
      ),
    enabled: Boolean(account && slug && name),
  });
}

export type AutomationAction =
  | { kind: 'save'; name: string; body: components['schemas']['SaveAutomationDraftRequest'] }
  | { kind: 'publish'; name: string; body: components['schemas']['PublishAutomationRequest'] }
  | { kind: 'enabled'; name: string; body: components['schemas']['SetAutomationEnabledRequest'] }
  | {
      kind: 'restore';
      name: string;
      version: number;
      body: components['schemas']['RestoreAutomationRevisionRequest'];
    };

export async function writeAutomation(slug: string, action: AutomationAction) {
  const params = { path: { slug, name: action.name } };
  switch (action.kind) {
    case 'save':
      return unwrap(api.PUT('/v1/apps/{slug}/automations/{name}', { params, body: action.body }));
    case 'publish':
      return unwrap(
        api.POST('/v1/apps/{slug}/automations/{name}/publish', { params, body: action.body })
      );
    case 'enabled':
      return unwrap(
        api.PUT('/v1/apps/{slug}/automations/{name}/enabled', { params, body: action.body })
      );
    case 'restore':
      return unwrap(
        api.POST('/v1/apps/{slug}/automations/{name}/revisions/{version}/restore', {
          params: { path: { ...params.path, version: action.version } },
          body: action.body,
        })
      );
  }
}

export function useWriteAutomation(account: string, slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: AutomationAction) => writeAutomation(slug, action),
    retry: false,
    onSettled: () => qc.invalidateQueries({ queryKey: root(account, slug) }),
  });
}

export function useValidateAutomation(slug: string) {
  return useMutation({
    mutationFn: (definition: Definition) =>
      unwrap(
        api.POST('/v1/apps/{slug}/automations:validate', {
          params: { path: { slug } },
          body: { definition },
        })
      ),
    retry: false,
    gcTime: 0,
  });
}

export function useSimulateAutomation(slug: string) {
  return useMutation({
    mutationFn: (body: components['schemas']['SimulateAutomationRequest']) =>
      unwrap(
        api.POST('/v1/apps/{slug}/automations:simulate', {
          params: { path: { slug } },
          body,
        })
      ),
    retry: false,
    gcTime: 0,
  });
}

export async function startAutomationRun(slug: string, name: string, input: unknown, key: string) {
  return unwrap(
    api.POST('/v1/apps/{slug}/workflows/{name}/runs', {
      params: { path: { slug, name }, header: { 'Idempotency-Key': key } },
      body: input,
    })
  );
}

export function useStartAutomationRun(account: string, slug: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, key }: { input: unknown; key: string }) =>
      startAutomationRun(slug, name, input, key),
    retry: false,
    gcTime: 0,
    onSettled: () => qc.invalidateQueries({ queryKey: root(account, slug) }),
  });
}
