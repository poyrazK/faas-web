import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'iconoir-react';
import { HostingDiagram, type HostingDiagramKind } from './hosting-diagrams';
import './feature-explorer.css';

type Availability = 'Public beta' | 'Preview' | 'In development';
type Diagram = 'deploy' | 'flow' | 'orbit' | HostingDiagramKind;
interface Feature {
  id: string;
  title: string;
  description: string;
  availability: Availability;
  diagram: Diagram;
  caption: string;
  doc?: string;
}

const GROUPS: { title: string; availability: string; features: Feature[] }[] = [
  {
    title: 'Hosting',
    availability: 'Beta & preview',
    features: [
      {
        id: 'source',
        title: 'Source deploys',
        description:
          'Take a commit from source to a running API. Follow the build and deployment together, through the CLI, API or console.',
        availability: 'Public beta',
        diagram: 'deploy',
        caption: 'An illustrated path from commit to running app.',
        doc: 'deploy-from-github',
      },
      {
        id: 'compute',
        title: 'Isolated compute',
        description:
          'Run your API inside its own Firecracker microVM. Bring your code and packages, within your plan’s runtime and resource limits.',
        availability: 'Public beta',
        diagram: 'compute',
        caption: 'Your app. Its own runtime boundary.',
        doc: 'runtime-node',
      },
      {
        id: 'scale',
        title: 'Scale to zero',
        description:
          'Let eligible idle applications park and wake when traffic returns. The first request waits for the wake; long-running workers have different lifecycle behavior.',
        availability: 'Public beta',
        diagram: 'scale',
        caption: 'Idle → wake → serve → park',
        doc: 'scale-to-zero',
      },
      {
        id: 'domains',
        title: 'Custom domains',
        description:
          'Put your API on your own domain. Verify DNS and follow certificate issuance in one place.',
        availability: 'Public beta',
        diagram: 'domain',
        caption: 'Your domain → your application',
        doc: 'custom-domains',
      },
      {
        id: 'traces',
        title: 'Logs & traces',
        description:
          'Follow runtime logs and request context when something goes wrong. Availability and retention depend on your plan.',
        availability: 'Public beta',
        diagram: 'trace',
        caption: 'Illustrative spans, not measured request timings.',
        doc: 'tracing',
      },
      {
        id: 'secrets',
        title: 'Secrets & config',
        description:
          'Keep secrets out of your repository. Gregale seals stored values and injects them into your runtime as environment variables.',
        availability: 'Public beta',
        diagram: 'secrets',
        caption: 'Configuration outside your source.',
        doc: 'storage',
      },
      {
        id: 'previews',
        title: 'PR previews',
        description:
          'Review eligible GitHub pull requests at their own preview URLs. Previews update on push and share your plan’s deployed-app limit.',
        availability: 'Public beta',
        diagram: 'previews',
        caption: 'A separate preview, before the merge.',
        doc: 'preview-environments',
      },
      {
        id: 'objects',
        title: 'Object storage',
        description:
          'Store files in private buckets outside your app’s runtime. Object storage is in preview; availability depends on the storage rollout.',
        availability: 'Preview',
        diagram: 'objects',
        caption: 'Object buckets, not persistent VM disks.',
        doc: 'object-storage',
      },
    ],
  },
  {
    title: 'Connected work',
    availability: 'Preview & development',
    features: [
      {
        id: 'services',
        title: 'Service connections',
        description:
          'Declare your service dependencies. Gregale provides stable addresses, checks permitted callers and can wake parked dependencies on request.',
        availability: 'Preview',
        diagram: 'orbit',
        caption: 'Services connected by declared dependencies.',
      },
      {
        id: 'jobs',
        title: 'Background jobs',
        description:
          'Schedule work and retry failed attempts. Gregale tracks timers and attempts; your handlers own the business logic and external effects.',
        availability: 'Preview',
        diagram: 'flow',
        caption: 'Schedule → handler → result',
      },
      {
        id: 'workflows',
        title: 'Workflows',
        description:
          'Run handlers across multiple steps and wait for callbacks. Gregale keeps workflow state; your code defines the steps and access rules.',
        availability: 'Preview',
        diagram: 'flow',
        caption: 'Run a step. Wait. Continue.',
      },
      {
        id: 'releases',
        title: 'Release coordination',
        description:
          'In development: revision context across managed calls and queued work, plus dependency checks before traffic moves to a deployment.',
        availability: 'In development',
        diagram: 'flow',
        caption: 'Connected changes, with revision context.',
      },
    ],
  },
];

/** Decorative wiring, not a live system diagram or account data. */
function Wiring() {
  return (
    <svg className="feature-wiring" viewBox="0 0 1100 500" fill="none" aria-hidden="true">
      {Array.from({ length: 14 }, (_, index) => {
        const y = -60 + index * 48;
        return (
          <g key={index}>
            <path d={`M 405 ${y} C 590 ${y}, 630 252, 1090 252`} />
            <circle cx="405" cy={y} r="6" />
            <path d={`M 480 ${y + 18} C 645 ${y + 18}, 690 275, 1150 275`} />
          </g>
        );
      })}
      <circle cx="825" cy="252" r="165" />
      <circle cx="825" cy="252" r="210" />
    </svg>
  );
}

function FeatureDiagram({ kind }: { kind: Diagram }) {
  if (kind === 'deploy') return <DeploymentDiagram />;
  if (kind !== 'flow' && kind !== 'orbit') return <HostingDiagram kind={kind} />;
  return (
    <svg viewBox="0 0 300 120" fill="none" aria-hidden="true" className="feature-diagram">
      {kind === 'flow' && (
        <>
          <path d="M 42 60 H 258" strokeDasharray="3 5" />
          {[42, 150, 258].map((x, index) => (
            <g key={x}>
              <rect x={x - 19} y="41" width="38" height="38" rx="8" />
              <circle
                cx={x}
                cy="60"
                r={index === 1 ? 8 : 4}
                className={index === 1 ? 'feature-node' : ''}
              />
            </g>
          ))}
          <path d="m 98 55 5 5 -5 5 M 204 55 l 5 5 -5 5" />
        </>
      )}
      {kind === 'orbit' && (
        <>
          {[0, 60, 120].map((angle) => (
            <ellipse
              key={angle}
              cx="150"
              cy="60"
              rx="78"
              ry="30"
              transform={`rotate(${angle} 150 60)`}
            />
          ))}
          <rect x="137" y="47" width="26" height="26" rx="6" className="feature-node" />
          <circle cx="73" cy="60" r="5" />
          <circle cx="188" cy="9" r="5" />
          <circle cx="188" cy="111" r="5" />
        </>
      )}
    </svg>
  );
}

/** An illustrative deployment, never presented as live account activity. */
function DeploymentDiagram() {
  return (
    <svg viewBox="0 0 420 210" fill="none" aria-hidden="true" className="deployment-diagram">
      <path
        className="deployment-guide"
        d="M 0 178 H 420 M 58 26 V 188 M 210 26 V 188 M 362 26 V 188"
      />
      <path className="deployment-track" d="M 112 103 H 156 M 264 103 H 308" />
      <path
        className="deployment-transfer deployment-transfer-first"
        pathLength="1"
        d="M 112 103 H 156"
      />
      <path
        className="deployment-transfer deployment-transfer-second"
        pathLength="1"
        d="M 264 103 H 308"
      />
      <path className="deployment-arrow" d="m 148 99 4 4 -4 4 M 300 99 l 4 4 -4 4" />

      <g className="deployment-step">
        <rect x="4" y="48" width="108" height="110" rx="8" />
        <path d="M 48 73 V 97 Q 48 105 58 105 H 68 M 48 85 H 58 Q 68 85 68 77" />
        <circle cx="48" cy="73" r="4" />
        <circle cx="68" cy="73" r="4" />
        <circle cx="68" cy="105" r="4" />
        <text x="58" y="138">
          Commit
        </text>
      </g>
      <g className="deployment-step">
        <rect x="156" y="48" width="108" height="110" rx="8" />
        <path d="m 210 70 19 10 -19 10 -19 -10 Z M 191 90 l 19 10 19 -10 M 191 100 l 19 10 19 -10" />
        <text x="210" y="138">
          Build
        </text>
      </g>
      <g className="deployment-step deployment-runtime">
        <rect x="308" y="48" width="108" height="110" rx="8" />
        <rect x="344" y="71" width="36" height="36" rx="5" />
        <path d="m 353 89 6 6 12 -13" />
        <text x="362" y="138">
          Running
        </text>
      </g>
      <g className="deployment-labels">
        <text x="58" y="199">
          Repository
        </text>
        <text x="210" y="199">
          Image
        </text>
        <text x="362" y="199">
          Deployment
        </text>
      </g>
    </svg>
  );
}

function destination(key: string, current: number, length: number, step: number) {
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  if (key === 'ArrowRight') return (current + 1) % length;
  if (key === 'ArrowLeft') return (current - 1 + length) % length;
  if (key === 'ArrowDown') return (current + step) % length;
  if (key === 'ArrowUp') return (current - step + length) % length;
  return null;
}

export function FeatureExplorer() {
  const id = useId();
  const [selection, setSelection] = useState({ group: 0, feature: 0 });
  const [interacted, setInteracted] = useState(false);
  const [connection, setConnection] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const categoryRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const featureRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const group = GROUPS[selection.group];
  const feature = group.features[selection.feature];
  const categoryId = `${id}-category-${selection.group}`;
  const panelId = `${id}-features`;
  const detailId = `${id}-detail`;
  const selectGroup = (index: number) => {
    setInteracted(true);
    setSelection({ group: index, feature: 0 });
  };
  const selectFeature = (index: number) => {
    setInteracted(true);
    setSelection({ ...selection, feature: index });
  };

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const tile = featureRefs.current[selection.feature];
    const detail = detailRef.current;
    if (!stage || !tile || !detail) return;
    const measure = () => {
      const bounds = stage.getBoundingClientRect();
      const start = tile.getBoundingClientRect();
      const end = detail.getBoundingClientRect();
      const x = start.right - bounds.left;
      const y = start.top + start.height / 2 - bounds.top;
      const targetX = end.left - bounds.left;
      const targetY = end.top + 40 - bounds.top;
      // On stacked layouts the diagram supplies the connection; no line crosses the text.
      setConnection(
        targetX > x
          ? `M ${x} ${y} C ${targetX - 24} ${y}, ${x + 24} ${targetY}, ${targetX} ${targetY}`
          : ''
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    observer.observe(tile);
    observer.observe(detail);
    return () => observer.disconnect();
  }, [selection]);

  const navigateCategory = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = destination(event.key, index, GROUPS.length, 1);
    if (next === null) return;
    event.preventDefault();
    selectGroup(next);
    categoryRefs.current[next]?.focus();
  };
  const navigateFeature = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = destination(event.key, index, group.features.length, 2);
    if (next === null) return;
    event.preventDefault();
    selectFeature(next);
    featureRefs.current[next]?.focus();
  };

  return (
    <section
      id="why"
      aria-labelledby={`${id}-title`}
      className="feature-explorer relative scroll-mt-24 border-t border-border"
    >
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="feature-explorer-heading">
          <h2
            id={`${id}-title`}
            className="max-w-[32rem] text-balance text-[36px] font-medium leading-[1.08] tracking-[-0.025em] text-foreground sm:text-[46px]"
          >
            Explore the pieces of your backend.
          </h2>
          <p className="max-w-[24rem] text-base leading-relaxed text-muted-foreground">
            Start with hosting today. Explore the services and background work we’re building around
            it.
          </p>
        </div>
        <div className="feature-categories" role="tablist" aria-label="Feature categories">
          {GROUPS.map((category, index) => (
            <button
              key={category.title}
              ref={(element) => {
                categoryRefs.current[index] = element;
              }}
              id={`${id}-category-${index}`}
              type="button"
              role="tab"
              aria-selected={selection.group === index}
              aria-controls={panelId}
              tabIndex={selection.group === index ? 0 : -1}
              onClick={() => selectGroup(index)}
              onKeyDown={(event) => navigateCategory(event, index)}
            >
              <span>{category.title}</span>
              <span className="feature-category-status">{category.availability}</span>
            </button>
          ))}
        </div>
        <div
          ref={stageRef}
          id={panelId}
          role="tabpanel"
          aria-labelledby={categoryId}
          className="feature-stage"
        >
          <Wiring />
          <svg className="feature-connection" aria-hidden="true">
            <path key={feature.id} d={connection} pathLength="1" data-animate={interacted} />
          </svg>
          <div className="feature-selector" role="tablist" aria-label="Features">
            {group.features.map((item, index) => (
              <button
                key={item.id}
                ref={(element) => {
                  featureRefs.current[index] = element;
                }}
                id={`${id}-${item.id}`}
                type="button"
                role="tab"
                aria-selected={selection.feature === index}
                aria-controls={detailId}
                tabIndex={selection.feature === index ? 0 : -1}
                onClick={() => selectFeature(index)}
                onKeyDown={(event) => navigateFeature(event, index)}
                className="feature-choice"
              >
                <span className="feature-choice-heading">
                  <span>{item.title}</span>
                  <span className="feature-number" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </span>
                <ArrowRight className="feature-choice-arrow" aria-hidden="true" />
              </button>
            ))}
          </div>
          <div
            ref={detailRef}
            id={detailId}
            role="tabpanel"
            aria-labelledby={`${id}-${feature.id}`}
            tabIndex={0}
            className="feature-detail"
          >
            <div key={feature.id} className="feature-detail-content" data-animate={interacted}>
              <div className="feature-detail-top">
                <span className="feature-number" aria-hidden="true">
                  {String(selection.feature + 1).padStart(2, '0')}
                </span>
                <span className="feature-availability" data-availability={feature.availability}>
                  {feature.availability}
                </span>
              </div>
              <h3>{feature.title}</h3>
              <p className="feature-description">{feature.description}</p>
              <div className="feature-illustration">
                <FeatureDiagram kind={feature.diagram} />
                <p>{feature.caption}</p>
              </div>
              {feature.doc ? (
                <Link to="/docs/$slug" params={{ slug: feature.doc }} className="feature-guide">
                  Read the guide <ArrowRight aria-hidden="true" />
                </Link>
              ) : (
                <span className="feature-guide-pending">Guide coming soon</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
