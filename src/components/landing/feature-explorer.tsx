import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'iconoir-react';
import { HostingDiagram, type HostingDiagramKind } from './hosting-diagrams';
import { ConnectedDiagram, type ConnectedDiagramKind } from './connected-diagrams';
import './feature-explorer.css';

type Availability = 'Beta' | 'Preview' | 'In development';
type Diagram = 'deploy' | HostingDiagramKind | ConnectedDiagramKind;
interface Feature {
  id: string;
  title: string;
  description: string;
  availability?: Availability;
  diagram: Diagram;
  caption: string;
  doc?: string;
}

const GROUPS: { title: string; features: Feature[] }[] = [
  {
    title: 'Hosting',
    features: [
      {
        id: 'source',
        title: 'Source deploys',
        description:
          'Take a commit from source to a running API. Follow the build and deployment together, through the CLI, API or console.',
        diagram: 'deploy',
        caption: 'An illustrated path from commit to running app.',
        doc: 'deploy-from-github',
      },
      {
        id: 'compute',
        title: 'Isolated compute',
        description:
          'Run your API inside its own Firecracker microVM. Bring your code and packages, within your plan’s runtime and resource limits.',
        diagram: 'compute',
        caption: 'Your app. Its own runtime boundary.',
        doc: 'runtime-node',
      },
      {
        id: 'scale',
        title: 'Scale to zero',
        description:
          'Let eligible idle applications park and wake when traffic returns. The first request waits for the wake; long-running workers have different lifecycle behavior.',
        diagram: 'scale',
        caption: 'Idle → wake → serve → park',
        doc: 'scale-to-zero',
      },
      {
        id: 'domains',
        title: 'Custom domains',
        description:
          'Put your API on your own domain. Verify DNS and follow certificate issuance in one place.',
        diagram: 'domain',
        caption: 'Your domain → your application',
        doc: 'custom-domains',
      },
      {
        id: 'traces',
        title: 'Logs & traces',
        description:
          'Follow runtime logs and request context when something goes wrong, from the CLI or the console.',
        diagram: 'trace',
        caption: 'One request’s spans, from the gateway into your handler.',
        doc: 'tracing',
      },
      {
        id: 'secrets',
        title: 'Secrets & config',
        description:
          'Keep secrets out of your repository. Gregale seals stored values and injects them into your runtime as environment variables.',
        diagram: 'secrets',
        caption: 'Configuration outside your source.',
        doc: 'secrets',
      },
      {
        id: 'previews',
        title: 'PR previews',
        description:
          'Review eligible GitHub pull requests at their own preview URLs. Previews update on push and have a separate allowance on your plan.',
        diagram: 'previews',
        caption: 'A separate preview, before the merge.',
        doc: 'preview-environments',
      },
      {
        id: 'objects',
        title: 'Object storage',
        description:
          'Store files in private, S3-compatible buckets outside your app’s runtime. Share them with signed URLs and use any S3 SDK.',
        diagram: 'objects',
        doc: 'object-storage',
        caption: 'Object buckets, not persistent VM disks.',
      },
    ],
  },
  {
    title: 'Connected work',
    features: [
      {
        id: 'services',
        title: 'Service connections',
        description:
          'Declare your service dependencies. Gregale provides stable addresses, checks permitted callers and can wake parked dependencies on request.',
        diagram: 'services',
        caption: 'A declared caller reaches its dependency by name.',
        doc: 'internal-services',
      },
      {
        id: 'jobs',
        title: 'Background jobs',
        description:
          'Schedule work and retry failed attempts. Gregale tracks timers and attempts; your handlers own the business logic and external effects.',
        availability: 'Beta',
        diagram: 'jobs',
        caption: 'Schedule → attempt → retry → result',
        doc: 'jobs',
      },
      {
        id: 'workflows',
        title: 'Workflows',
        description:
          'Run handlers across multiple steps and wait for callbacks. Gregale keeps workflow state; your code defines the steps and access rules.',
        availability: 'Beta',
        diagram: 'workflows',
        caption: 'Run a step. Wait for a callback. Continue.',
        doc: 'code-workflows',
      },
      {
        id: 'releases',
        title: 'Release coordination',
        description:
          'In development: revision context across managed calls and queued work, plus dependency checks before traffic moves to a deployment.',
        availability: 'In development',
        diagram: 'releases',
        caption: 'Dependencies checked before traffic moves.',
        doc: 'service-release-graphs',
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

const CONNECTED: ReadonlySet<Diagram> = new Set(['services', 'jobs', 'workflows', 'releases']);

function FeatureDiagram({ kind }: { kind: Diagram }) {
  if (kind === 'deploy') return <DeploymentDiagram />;
  if (CONNECTED.has(kind)) return <ConnectedDiagram kind={kind as ConnectedDiagramKind} />;
  return <HostingDiagram kind={kind as HostingDiagramKind} />;
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
                {feature.availability && (
                  <span className="feature-availability" data-availability={feature.availability}>
                    {feature.availability}
                  </span>
                )}
              </div>
              <h3>{feature.title}</h3>
              <p className="feature-description">{feature.description}</p>
              <div className="feature-illustration">
                <FeatureDiagram kind={feature.diagram} />
                <p>{feature.caption}</p>
              </div>
              {feature.doc && (
                <Link to="/docs/$slug" params={{ slug: feature.doc }} className="feature-guide">
                  Read the guide <ArrowRight aria-hidden="true" />
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
