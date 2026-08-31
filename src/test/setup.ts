import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * jsdom implements `localStorage`, but Vitest's jsdom environment does not
 * expose it on the global `window` here. The app reads it during render — the
 * session, the workspace, the sidebar collapse state — so tests need a real
 * one. This shim is also the more honest thing to test against: state is
 * guaranteed empty at the start of every test rather than inherited.
 */
if (!window.localStorage) {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
  };
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}

// React Testing Library does not auto-clean in every setup path, and a leaked
// tree makes the *next* test's queries ambiguous rather than failing where the
// problem actually is.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

// jsdom implements neither, and both are read during render by the sidebar,
// the charts, and anything calling `useReducedMotion`.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Used by the command palette to keep the active row in view.
Element.prototype.scrollIntoView ??= () => {};

// jsdom implements none of these. motion's `useInView` / `whileInView`
// construct an IntersectionObserver on mount (nothing ever intersects under
// this shim, so in-view animations hold their initial frame); the router
// calls `scrollTo` on navigation; the DotCut engine asks a canvas for a 2D
// context and already treats `null` as "draw nothing".
window.IntersectionObserver ??= class {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
};
window.scrollTo = () => {};
HTMLCanvasElement.prototype.getContext = (() =>
  null) as typeof HTMLCanvasElement.prototype.getContext;
