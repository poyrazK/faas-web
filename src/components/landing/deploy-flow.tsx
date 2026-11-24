import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { MARKS, type MarkName } from './deploy-flow-marks';
import './deploy-flow.css';

/**
 * From repository to running API, as one picture: what goes in (your agent,
 * your repository, a prompt or a command), the deploy itself running step by
 * step in the middle, and what comes out (a verified URL and a preview for
 * every pull request). Example data, labelled as such under the panel.
 *
 * The middle card plays Gregale's real deploy steps in a loop, three at a
 * time; the outputs settle as their steps finish. It only moves while on
 * screen, and under reduced motion it rests on the finished deploy.
 */

export const DEPLOY_STEPS = [
  'Fetch main @ 3f2a1c9',
  'Detect Node 24',
  'Install packages',
  'Build in an isolated VM',
  'Create the image',
  'Seal 3 secrets',
  'Run migrations',
  'Boot a microVM',
  'Take a snapshot',
  'Check health',
  'Move traffic',
  'Park when idle',
] as const;

const RUNNING = 3; // steps in flight at once
const ROW = 33; // row height + gap, px
const VISIBLE = 7;
const BEAT = 650; // ms per step
const LOOP = DEPLOY_STEPS.length + RUNNING + 5; // beats, with a rest at the end
/** The server-rendered (and first client) frame: mid-deploy, so it reads alive. */
const FIRST_TICK = 6;
const FINISHED = DEPLOY_STEPS.length + RUNNING;
const PROMPT = 'Deploy my-api and give it a database.';

const REDUCE = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (notify: () => void) => {
  const query = window.matchMedia(REDUCE);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};

type StepState = 'pending' | 'running' | 'done';
export const stepState = (tick: number, i: number): StepState =>
  tick >= i + RUNNING ? 'done' : tick >= i ? 'running' : 'pending';

function Mark({ name, size }: { name: MarkName; size: number }) {
  if (name === 'cursor')
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      >
        <path d="M12 2 3.5 7v10L12 22l8.5-5V7z" />
        <path d="M3.5 7 12 12l8.5-5M12 12v10" />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d={MARKS[name]} />
    </svg>
  );
}

const TAB_PATH =
  'M0 19C7 19 9 16.5 9 11V8.5C9 3.8 12.8 0 17.5 0H42.5C47.2 0 51 3.8 51 8.5V11C51 16.5 53 19 60 19Z';

function Card({
  id,
  icon,
  title,
  className = '',
  children,
}: {
  id: string;
  /** The folder tab's icon; a card without one has no tab. */
  icon?: ReactNode;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div data-flow={id} className={`deploy-flow-card ${className}`}>
      {icon && (
        <span className="deploy-flow-tab">
          <svg viewBox="0 0 60 19" aria-hidden>
            <path d={TAB_PATH} />
          </svg>
          <svg
            viewBox="0 0 12 12"
            aria-hidden
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {icon}
          </svg>
        </span>
      )}
      {title && <h3 className="text-[16.5px] font-medium tracking-[-0.012em]">{title}</h3>}
      {children}
    </div>
  );
}

const CHIPS: { mark: MarkName; label: string; size: number }[] = [
  { mark: 'github', label: 'GitHub', size: 14 },
  { mark: 'node', label: 'Node', size: 14 },
  { mark: 'python', label: 'Python', size: 14 },
  { mark: 'go', label: 'Go', size: 16 },
  { mark: 'docker', label: 'Dockerfile', size: 15 },
];

/** GitHub is connected from the start and Node is the runtime detected; the
 *  others flicker while detection looks at the repository. */
const chipLit = (tick: number, i: number) =>
  i === 0 || (i === 1 ? tick >= 2 : tick >= DEPLOY_STEPS.length || (tick + i * 2) % 5 >= 2);

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done')
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
        <circle cx="7" cy="7" r="6.2" fill="var(--df-ink-3)" />
        <path d="M4.3 7.2 6.1 9 9.8 5.1" fill="none" stroke="var(--card)" strokeWidth="1.5" />
      </svg>
    );
  if (state === 'running')
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
        <g className="deploy-flow-spin" fill="var(--df-go-ink)">
          {Array.from({ length: 8 }, (_, i) => (
            <circle
              key={i}
              cx={7 + 5 * Math.cos((i * Math.PI) / 4)}
              cy={7 + 5 * Math.sin((i * Math.PI) / 4)}
              r="1.05"
              opacity={0.2 + i * 0.11}
            />
          ))}
        </g>
      </svg>
    );
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <circle
        cx="7"
        cy="7"
        r="5.6"
        fill="none"
        stroke="var(--df-ink-3)"
        strokeOpacity="0.6"
        strokeWidth="1.2"
        strokeDasharray="1.8 2.1"
      />
    </svg>
  );
}

/** Hairline elbows from each input to the deploy, and from the deploy to each
 *  output, measured from the laid-out cards (desktop only). */
function useConnectors(stage: React.RefObject<HTMLDivElement | null>) {
  const [paths, setPaths] = useState<string[]>([]);
  useLayoutEffect(() => {
    const host = stage.current;
    if (!host) return;
    const measure = () => {
      const s = host.getBoundingClientRect();
      const box = (id: string) => {
        const el = host.querySelector<HTMLElement>(`[data-flow="${id}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { l: r.left - s.left, r: r.right - s.left, y: r.top - s.top + r.height / 2 };
      };
      const mid = box('deploy');
      if (!mid || window.innerWidth < 1024) return setPaths([]);
      const elbow = (x1: number, y1: number, x2: number, y2: number) => {
        if (Math.abs(y2 - y1) < 2) return `M${x1} ${y1}H${x2}`;
        const mx = (x1 + x2) / 2;
        const r = Math.min(14, Math.abs(y2 - y1) / 2);
        const d = Math.sign(y2 - y1);
        return `M${x1} ${y1}H${mx - r}Q${mx} ${y1} ${mx} ${y1 + d * r}V${y2 - d * r}Q${mx} ${y2} ${mx + r} ${y2}H${x2}`;
      };
      const next: string[] = [];
      for (const id of ['agent', 'repo', 'prompt']) {
        const a = box(id);
        if (a) next.push(elbow(a.r, a.y, mid.l, mid.y));
      }
      for (const id of ['url', 'preview']) {
        const b = box(id);
        if (b) next.push(elbow(mid.r, mid.y, b.l, b.y));
      }
      setPaths(next);
    };
    measure();
    // Cards resize on their own (text wrapping, the card font arriving), so
    // watch each of them as well as the stage.
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    host.querySelectorAll('[data-flow]').forEach((el) => ro.observe(el));
    let live = true;
    void document.fonts?.ready.then(() => live && measure());
    return () => {
      live = false;
      ro.disconnect();
    };
  }, [stage]);
  return paths;
}

export function DeployFlow() {
  const stage = useRef<HTMLDivElement>(null);
  // The server snapshot is "moving", so the prerendered frame is mid-deploy.
  const reduce = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(REDUCE).matches,
    () => false
  );
  const [beat, setTick] = useState(FIRST_TICK);
  // Under reduced motion the picture rests on the finished deploy.
  const tick = reduce ? FINISHED : beat;
  const [typed, setTyped] = useState(PROMPT.length);
  const paths = useConnectors(stage);

  // Play only while on screen; rest on the finished deploy under reduced motion.
  useEffect(() => {
    const host = stage.current;
    if (!host) return;
    if (reduce) return;
    let beat: number | undefined;
    let type: number | undefined;
    let k = 0;
    const start = () => {
      if (beat !== undefined) return;
      beat = window.setInterval(() => setTick((t) => (t + 1) % LOOP), BEAT);
      const typeNext = () => {
        k = k > PROMPT.length + 40 ? 0 : k + 1;
        setTyped(Math.min(k, PROMPT.length));
        type = window.setTimeout(typeNext, k > PROMPT.length ? 60 : 45);
      };
      typeNext();
    };
    const stop = () => {
      window.clearInterval(beat);
      window.clearTimeout(type);
      beat = type = undefined;
    };
    // Play while the deploy card itself is on screen: the stacked stage is far
    // taller than a phone, so watching the whole stage would misfire.
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()), {
      threshold: 0,
    });
    io.observe(host.querySelector('[data-flow="deploy"]') ?? host);
    return () => {
      io.disconnect();
      stop();
    };
  }, [reduce]);

  const states = DEPLOY_STEPS.map((_, i) => stepState(tick, i));
  const done = states.filter((s) => s === 'done').length;
  const running = states.filter((s) => s === 'running').length;
  const top = Math.max(0, Math.min(DEPLOY_STEPS.length - VISIBLE + 1, tick - 2));
  const checks = [
    { label: 'Build', ok: done >= 5 },
    { label: 'Health', ok: done >= 10 },
    { label: 'TLS', ok: done >= 11 },
  ];

  return (
    <div className="deploy-flow">
      <p className="sr-only">
        Example: you or your agent ask Gregale to deploy my-api from a repository. Gregale fetches
        the code, detects the runtime, builds it in an isolated VM, seals its secrets, runs
        migrations, boots a microVM, checks its health and moves traffic, then serves it at a
        verified URL, with a preview for every pull request.
      </p>
      <div
        ref={stage}
        aria-hidden
        className="deploy-flow-stage relative overflow-hidden rounded-[20px] px-4 py-12 sm:px-8 lg:px-10 lg:py-16 xl:px-[60px]"
      >
        <div className="deploy-flow-light" />
        <svg className="deploy-flow-lines pointer-events-none absolute inset-0 hidden h-full w-full lg:block">
          {paths.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>

        <div className="relative grid gap-12 lg:grid-cols-[minmax(0,368px)_minmax(0,320px)_minmax(0,368px)] lg:items-center lg:justify-between lg:gap-0">
          {/* What goes in */}
          <div className="flex flex-col gap-9 lg:gap-[30px]">
            <Card
              id="agent"
              title="Bring the agent you already use"
              icon={
                <>
                  <rect x="2" y="3.5" width="8" height="5.5" rx="1" />
                  <path d="M4.5 3.5V2.5h3v1" />
                </>
              }
            >
              <div className="mt-4 flex gap-[9px]">
                {(['claude', 'openai', 'cursor', 'gemini'] as const).map((m) => (
                  <span
                    key={m}
                    className="deploy-flow-chip grid size-[42px] place-items-center rounded-[9px] text-[var(--df-ink)]"
                  >
                    <Mark name={m} size={20} />
                  </span>
                ))}
              </div>
            </Card>
            <Card
              id="repo"
              title="Any repository, as it is"
              icon={
                <>
                  <path d="M3.5 1.8h3.2L8.5 3.6v6.6h-5z" />
                  <path d="M5 6h2M5 7.8h2" />
                </>
              }
            >
              <div className="mt-4 flex max-w-[330px] flex-wrap gap-2">
                {CHIPS.map((c, i) => {
                  const lit = chipLit(tick, i);
                  return (
                    <span
                      key={c.label}
                      className="deploy-flow-chip inline-flex h-[30px] items-center gap-[7px] rounded-lg px-[11px] text-[13.5px] transition-colors duration-300"
                      style={{ color: lit ? 'var(--df-ink)' : 'var(--df-ink-3)' }}
                    >
                      <span
                        className="transition-opacity duration-300"
                        style={{ opacity: lit ? 1 : 0.35 }}
                      >
                        <Mark name={c.mark} size={c.size} />
                      </span>
                      {c.label}
                      <i
                        className="ml-[3px] size-[7px] rounded-full transition-colors duration-300"
                        style={{ background: lit ? 'var(--df-go)' : 'var(--df-line)' }}
                      />
                    </span>
                  );
                })}
              </div>
            </Card>
            <Card
              id="prompt"
              title="Describe it anywhere"
              icon={<path d="M6 9.5v-7M3.2 5.2 6 2.5l2.8 2.7" />}
            >
              <div className="deploy-flow-chip mt-4 flex h-10 items-center justify-between rounded-[9px] pl-[13px] pr-2 text-[14px]">
                <span className="deploy-flow-caret min-w-0 truncate">{PROMPT.slice(0, typed)}</span>
                <span className="grid size-6 place-items-center rounded-md bg-[var(--df-ink)] text-[var(--card)]">
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    aria-hidden
                  >
                    <path d="M6 10V2.5M2.8 5.5 6 2.3l3.2 3.2" />
                  </svg>
                </span>
              </div>
            </Card>
          </div>

          {/* The deploy */}
          <Card id="deploy" className="p-[22px] lg:justify-self-center">
            <div className="flex items-center gap-3">
              <span className="deploy-flow-chip grid size-8 place-items-center rounded-lg">
                <img src="/favicon.png" alt="" width={20} height={20} />
              </span>
              <span>
                <b className="block text-[16px] font-medium tracking-[-0.012em]">Deploy my-api</b>
                <small className="text-[11.5px] text-[var(--df-ink-3)]">
                  Release 42 · {running} running
                </small>
              </span>
            </div>
            <div className="deploy-flow-list relative -mx-2 mt-3.5 h-[220px] overflow-hidden">
              <div
                className="deploy-flow-track"
                style={{ transform: `translateY(${-top * ROW + 10}px)` }}
              >
                {DEPLOY_STEPS.map((step, i) => (
                  <div
                    key={step}
                    data-state={states[i]}
                    className="deploy-flow-row mb-0.5 grid h-[31px] grid-cols-[16px_1fr_auto] items-center gap-[11px] rounded-[7px] px-2.5 text-[13.5px]"
                    style={{
                      background: states[i] === 'running' ? 'var(--df-chip)' : 'transparent',
                      color: states[i] === 'running' ? 'var(--df-ink)' : 'var(--df-ink-2)',
                    }}
                  >
                    <StepIcon state={states[i]} />
                    <span>{step}</span>
                    <span className="font-mono text-[11px] text-[var(--df-ink-3)]">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="deploy-flow-chip mt-[18px] h-[3px] overflow-hidden rounded-sm">
              <i
                className="block h-full rounded-sm bg-[var(--df-ink)] transition-[width] duration-500"
                style={{ width: `${(done / DEPLOY_STEPS.length) * 100}%` }}
              />
            </div>
            <p className="mt-2 text-[11.5px] tabular-nums text-[var(--df-ink-3)]">
              {done} of {DEPLOY_STEPS.length} steps done
            </p>
          </Card>

          {/* What comes out */}
          <div className="flex flex-col gap-9 lg:gap-[30px]">
            <Card
              id="url"
              title="A live, verified URL"
              icon={
                <>
                  <circle cx="6" cy="6" r="3.6" />
                  <path d="M4.4 6.1 5.5 7.2 7.7 4.9" />
                </>
              }
            >
              <div className="mt-[15px] flex items-center justify-between">
                <b className="flex items-center gap-[9px] text-[14.5px] font-medium">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="var(--df-go-ink)"
                    strokeWidth={1.8}
                    aria-hidden
                  >
                    <path d="M2.5 7.4 5.5 10.4 11.5 3.8" />
                  </svg>
                  my-api is live
                </b>
                <span className="text-[14px] text-[var(--df-ink-3)]">release 42</span>
              </div>
              <p className="mt-[7px] font-mono text-[11.5px] text-[var(--df-ink-3)]">
                <span className="text-[var(--df-go-ink)]">main</span> @ 3f2a1c9 · my-api.gregale.app
              </p>
              <div className="mt-[13px] flex gap-[18px] border-y border-[var(--df-chip)] py-[11px] text-[13.5px] text-[var(--df-ink-2)]">
                {checks.map((c) => (
                  <span
                    key={c.label}
                    className="inline-flex items-center gap-[7px] transition-opacity duration-300"
                    style={{ opacity: c.ok ? 1 : 0.38 }}
                  >
                    <span className="grid size-3.5 place-items-center rounded-full bg-[var(--df-ink-3)]">
                      <svg
                        width="8"
                        height="8"
                        viewBox="0 0 8 8"
                        fill="none"
                        stroke="var(--card)"
                        strokeWidth={1.5}
                        aria-hidden
                      >
                        <path d="M1.6 4.1 3.2 5.7 6.4 2.4" />
                      </svg>
                    </span>
                    {c.label}
                  </span>
                ))}
              </div>
              <div className="mt-[13px] flex h-9 items-center justify-center gap-2 rounded-lg bg-[var(--mint-9)] text-[14px] font-medium text-[var(--card)]">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  aria-hidden
                >
                  <path d="M4 8 8.5 3.5M5 3.5h3.5V7" />
                </svg>
                Open my-api
              </div>
            </Card>
            <Card
              id="preview"
              title="A preview of every pull request"
              icon={
                <>
                  <rect x="1.8" y="2.5" width="8.4" height="7" rx="1.2" />
                  <path d="M1.8 4.6h8.4" />
                </>
              }
            >
              <div className="deploy-flow-chip mt-4 rounded-[9px] px-[7px] pb-[7px] pt-1.5">
                <p className="flex gap-2.5 px-1.5 pb-2 pt-1 font-mono text-[11.5px] text-[var(--df-ink-2)]">
                  <span className="tracking-[1px] text-[var(--df-ink-3)]">•••</span>
                  pr-17--my-api.gregale.app
                </p>
                <div className="rounded-md bg-[var(--card)] px-3.5 pb-1.5 pt-3">
                  <p className="mb-1.5 text-[14px] font-medium">Requests</p>
                  {[
                    ['GET /health', '4 ms', '200'],
                    ['GET /v1/orders', '38 ms', '200'],
                    ['POST /v1/orders', '61 ms', '201'],
                  ].map(([path, ms, code]) => (
                    <div
                      key={path}
                      className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-t border-[var(--df-chip)] py-1.5 font-mono text-[11.5px]"
                    >
                      <span>{path}</span>
                      <span className="text-[var(--df-ink-3)]">{ms}</span>
                      <span
                        className="rounded px-1.5 py-0.5 text-[10.5px]"
                        style={{ background: 'var(--brand-muted)', color: 'var(--brand)' }}
                      >
                        {code}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
      <p className="mt-3 font-mono text-[10.5px] tracking-[0.04em] text-muted-foreground">
        Example data
      </p>
    </div>
  );
}
