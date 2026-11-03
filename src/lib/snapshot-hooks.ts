import type { App } from '@/lib/api/queries';
import type { components } from '@/lib/api/schema';
import { executionMode } from '@/lib/health-probes';

/**
 * Snapshot lifecycle hooks (ledger C48): `after_restore` and
 * `before_checkpoint`, loopback POSTs into the app around a snapshot.
 *
 * They are app state on `AppResponse.manifest`, written by `PATCH
 * /v1/apps/{slug}` (faas apidserver/lifecycle.go:265-278, where a hook with
 * neither path nor timeout clears it) and by a gregale.yaml `lifecycle:` block
 * on deploy (source_ref_manifest.go:838). The rules below are apid's own
 * (pkg/api/appmanifest.go:87-101 validateLifecycleHook, :810-821).
 */

export type HookKey = 'after_restore' | 'before_checkpoint';
export const HOOK_KEYS: readonly HookKey[] = ['after_restore', 'before_checkpoint'];
type Hook = components['schemas']['AfterRestoreHook'];

/** faas pkg/api/limits.go:1994-1995: a restore hook is on the wake path. */
export const HOOK_DEFAULT_TIMEOUT_MS = 500;
export const HOOK_MAX_TIMEOUT_MS = 2000;

/** The form's view of one hook: text as typed, an empty timeout meaning the default. */
export type HookDraft = { path: string; timeout_ms: string };

export function hookDraft(app: App, key: HookKey): HookDraft {
  const hook = app.manifest?.[key];
  return { path: hook?.path ?? '', timeout_ms: hook?.timeout_ms ? String(hook.timeout_ms) : '' };
}

export function hookErrors(draft: HookDraft): { path?: string; timeout_ms?: string } {
  const out: { path?: string; timeout_ms?: string } = {};
  const { path, timeout_ms } = draft;
  if (path === '' && timeout_ms !== '')
    out.path = 'A path is required. Clear the timeout too to remove the hook.';
  else if (path !== '' && (!path.startsWith('/') || path.startsWith('//') || /[?#%]/.test(path)))
    out.path = 'An absolute path such as /internal/after-restore, with no query, fragment or %.';
  // eslint-disable-next-line no-control-regex -- apid refuses exactly these bytes
  else if (/[\u0000-\u001f\u007f]/.test(path)) out.path = 'No control characters.';
  if (timeout_ms !== '') {
    const n = Number(timeout_ms);
    if (!Number.isInteger(n) || n < 0 || n > HOOK_MAX_TIMEOUT_MS)
      out.timeout_ms = `Whole milliseconds, 0 to ${HOOK_MAX_TIMEOUT_MS.toLocaleString('en-US')}.`;
  }
  return out;
}

/**
 * What a PATCH carries for one hook: nothing when unchanged, `{}` to clear it,
 * otherwise the hook. An empty timeout is left out so apid's default applies
 * rather than being pinned.
 */
export function hookChange(base: HookDraft, draft: HookDraft): Hook | undefined {
  if (base.path === draft.path && base.timeout_ms === draft.timeout_ms) return undefined;
  if (draft.path === '') return {};
  return draft.timeout_ms === ''
    ? { path: draft.path }
    : { path: draft.path, timeout_ms: Number(draft.timeout_ms) };
}

/** Hooks are refused outside request and service mode (appmanifest.go:813, 819). */
export function hooksApply(app: App): boolean {
  const mode = executionMode(app);
  return mode === 'request' || mode === 'service';
}

// A plain YAML scalar unless the path holds something YAML would read otherwise.
const scalar = (s: string) => (/^[\w\-./~!$&'()*+,;=@]+$/.test(s) ? s : JSON.stringify(s));

/** The set hooks as the gregale.yaml `lifecycle:` block that declares them. */
export function hooksYaml(drafts: Record<HookKey, HookDraft>): string {
  const lines = HOOK_KEYS.flatMap((key) => {
    const { path, timeout_ms } = drafts[key];
    if (!path) return [];
    return [
      `  ${key}:`,
      `    path: ${scalar(path)}`,
      ...(timeout_ms ? [`    timeout_ms: ${timeout_ms}`] : []),
    ];
  });
  return lines.length ? ['lifecycle:', ...lines].join('\n') : '';
}
