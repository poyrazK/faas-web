import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('aria-hidden') && el.offsetParent !== null
  );
}

function isTopmostDialog(root: HTMLElement): boolean {
  if (root.getAttribute('role') !== 'dialog' || root.getAttribute('aria-modal') !== 'true') {
    return true;
  }

  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
  return dialogs[dialogs.length - 1] === root;
}

function canRestoreFocus(root: HTMLElement, restore: HTMLElement | null): boolean {
  if (root.isConnected) return isTopmostDialog(root);

  // A conditionally unmounted dialog is already absent from the selector. Do
  // not restore focus over another dialog, unless the saved target belongs to
  // that dialog and is therefore safe to return to.
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
  const topmost = dialogs[dialogs.length - 1];
  return !topmost || topmost.contains(restore);
}

/**
 * Keeps keyboard focus inside `ref` while `active`: moves focus in on open
 * (first focusable, else the container), wraps Tab / Shift+Tab, and returns
 * focus to the previously focused element on close.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    const restore = document.activeElement as HTMLElement | null;

    // Let the dialog paint (and any autoFocus fire) before we pick a target.
    const frame = requestAnimationFrame(() => {
      if (!isTopmostDialog(root)) return;
      if (root.contains(document.activeElement)) return;
      const first = focusables(root)[0];
      if (first) first.focus();
      else {
        if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
        root.focus();
      }
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !isTopmostDialog(root)) return;
      const items = focusables(root);
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (current === first || !root.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !root.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      if (canRestoreFocus(root, restore)) restore?.focus?.();
    };
  }, [ref, active]);
}
