import type { components } from '../src/lib/api/schema';

type S = components['schemas'];
type Method = S['AppOpenAPIPolicyPreviewRoute']['method'];
const METHODS: Method[] = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** Fixture comparison only; it does not probe an app or a route collector. */
export function mockOpenAPIPreview(
  appId: string,
  document: Record<string, unknown> | undefined,
  observedPaths: string[],
  policies: S['EdgeRuleResponse'][]
): S['AppOpenAPIPolicyPreviewResponse'] {
  const routes = new Map<string, S['AppOpenAPIPolicyPreviewRoute']>();
  const add = (path: string, method: Method, declared: boolean, observed: boolean) => {
    const key = `${method}:${path}`;
    const previous = routes.get(key);
    const isDeclared = declared || Boolean(previous?.declared);
    const isObserved = observed || Boolean(previous?.observed);
    const rules = policies
      .filter((rule) => {
        const pathMatch =
          !rule.match_path ||
          rule.match_path === '*' ||
          rule.match_path === path ||
          (rule.match_path.endsWith('*') && path.startsWith(rule.match_path.slice(0, -1)));
        return (
          pathMatch &&
          (!rule.match_methods.length ||
            rule.match_methods.some((value) => value.toLowerCase() === method))
        );
      })
      .map((rule) => ({
        id: rule.id,
        match_host: rule.match_host,
        match_path: rule.match_path,
        match_methods: rule.match_methods,
        priority: rule.priority,
        enabled: rule.enabled,
        kind: rule.kind,
        validate_mode: rule.validate_mode ?? undefined,
        action: rule.action as Record<string, unknown>,
      }));
    routes.set(key, {
      path,
      method,
      declared: isDeclared,
      observed: isObserved,
      status: isDeclared && isObserved ? 'matched' : isDeclared ? 'declared_only' : 'observed_only',
      covered: rules.some((rule) => rule.enabled),
      rules,
    });
  };
  const paths = document?.paths as Record<string, Record<string, unknown>> | undefined;
  for (const [path, item] of Object.entries(paths ?? {}))
    for (const method of METHODS) if (item[method]) add(path, method, true, false);
  for (const path of observedPaths) add(path, 'get', false, true);
  return {
    app_id: appId,
    source: document ? 'preview' : 'empty: no_import',
    observed_available: true,
    observed_source: 'live',
    observed_inventory_available: false,
    observed_cap_hit: false,
    collectors_expected: 1,
    collectors_healthy: 1,
    openapi_version: typeof document?.openapi === 'string' ? document.openapi : undefined,
    routes: [...routes.values()].sort(
      (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)
    ),
  };
}
