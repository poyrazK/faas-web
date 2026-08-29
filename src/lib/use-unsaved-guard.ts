import { useBlocker } from '@tanstack/react-router';

/**
 * Warns before edits are silently discarded: blocks in-app navigation while
 * `dirty`, and arms the browser's own leave prompt for tab close / reload.
 *
 * `ask` supplies the question — usually the shared confirm dialog, so the
 * moment looks like every other destructive confirmation. It resolves true
 * to leave. Without it, the native `window.confirm` stands in.
 */
export function useUnsavedGuard(dirty: boolean, ask?: () => Promise<boolean>) {
  useBlocker({
    shouldBlockFn: async () => {
      if (!dirty) return false;
      const leave = ask ? await ask() : window.confirm('Discard unsaved changes?');
      return !leave;
    },
    enableBeforeUnload: () => dirty,
    disabled: !dirty,
  });
}
