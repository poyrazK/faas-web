import type { CSSProperties } from 'react';
import type { AppSource } from './new-app-source';
import './new-app-bento.css';

/** `--i` staggers a scene's parts in CSS; React types do not know custom properties. */
const at = (i: number) => ({ '--i': i }) as CSSProperties;

function GitScene() {
  return (
    <div className="nab-scene nab-git">
      <div className="nab-row">
        <span className="nab-chip nab-mono">acme/storefront</span>
        <span className="nab-chip nab-mono nab-dim">main</span>
      </div>
      <div className="nab-rail">
        {['Queued', 'Building', 'Deploying', 'Live'].map((label, i) => (
          <span key={label} className="nab-seg" style={at(i)}>
            <span className="nab-seg-bar" />
            <span className="nab-seg-label">{label}</span>
          </span>
        ))}
      </div>
      <span className="nab-url nab-mono">storefront.gregale.app</span>
    </div>
  );
}

function TemplateScene() {
  const files = ['src/', '  index.ts', '  handler.ts', 'gregale.yaml'];
  return (
    <div className="nab-scene nab-template">
      <div className="nab-tree nab-mono">
        {files.map((f, i) => (
          <span key={f} className="nab-line" style={at(i)}>
            {f}
          </span>
        ))}
      </div>
      <div className="nab-row">
        {['Node', 'Python', 'Go'].map((r) => (
          <span key={r} className="nab-chip nab-dim">
            {r}
          </span>
        ))}
      </div>
    </div>
  );
}

function EmptyScene() {
  return (
    <div className="nab-scene nab-empty">
      <div className="nab-box" />
      <div className="nab-prompt nab-mono">
        <span className="nab-dim">$</span> <span className="nab-type">gregale deploy</span>
        <span className="nab-caret" />
      </div>
    </div>
  );
}

function ContainerScene() {
  return (
    <div className="nab-scene nab-container">
      <span className="nab-chip nab-mono">sha256:7f3a…c91e</span>
      <div className="nab-layers">
        {[0, 1, 2].map((i) => (
          <span key={i} className="nab-layer" style={at(2 - i)} />
        ))}
      </div>
    </div>
  );
}

function WorkerScene() {
  return (
    <div className="nab-scene nab-worker">
      <svg viewBox="0 0 160 40" className="nab-beat" preserveAspectRatio="none">
        <path d="M0 22 H50 L58 8 L66 34 L74 22 H160" />
      </svg>
      <span className="nab-chip nab-dim nab-struck">HTTP</span>
    </div>
  );
}

function ImportScene() {
  return (
    <div className="nab-scene nab-import">
      <span className="nab-chip nab-mono">compose.yaml</span>
      <svg viewBox="0 0 120 40" className="nab-fan" preserveAspectRatio="none">
        <path d="M60 0 C60 20 20 20 20 40" />
        <path d="M60 0 V40" />
        <path d="M60 0 C60 20 100 20 100 40" />
      </svg>
      <div className="nab-row nab-services">
        {['web', 'worker', 'db'].map((s, i) => (
          <span key={s} className="nab-chip nab-mono" style={at(i)}>
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

const SCENES: Record<AppSource, () => React.JSX.Element> = {
  git: GitScene,
  template: TemplateScene,
  empty: EmptyScene,
  container: ContainerScene,
  worker: WorkerScene,
  import: ImportScene,
};

/**
 * Each source shown, not described: a small still scene that replays a short
 * loop while its cell is hovered, focused or chosen. CSS only (no timers, no
 * per-frame JavaScript); reduced motion leaves the still frame.
 */
export function SourcePreview({ id }: { id: AppSource }) {
  const Scene = SCENES[id];
  return (
    <div aria-hidden="true" className="nab-preview" data-preview={id}>
      <Scene />
    </div>
  );
}
