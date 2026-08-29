import { motion } from 'motion/react';
import { Check, GitBranch, GitPullRequest, Lock, Package, Rocket } from 'iconoir-react';
import { forwardRef, useRef, type ReactNode } from 'react';
import { AnimatedBeam } from '@/components/landing/animated-beam';
import { DotCutCanvas } from '@/components/dotcut/dot-cut-canvas';
import type { Scene } from '@/components/dotcut/scenes';
import { Marquee } from '@/components/landing/marquee';
import { cn } from '@/lib/utils';
import { EASE } from './reveal';

/**
 * The bento's backgrounds — one per tile, in the Magic UI manner: the layer
 * fills the card and fades toward the copy at the bottom.
 *
 * Every string here is something the product actually has. Handler snippets
 * are the runtime docs' own examples; the provider chips are storage.md's
 * list; the wake states are the console's badges. Where a number appears it
 * is illustrative and says nothing a reader could mistake for a metric.
 */

/** Fade any background toward the copy. */
const FADE = '[mask-image:linear-gradient(to_top,transparent_38%,#000_100%)]';

/* ------------------------------------------------------------------------ */
/* Functions — tilted marquee of handler files                               */
/* ------------------------------------------------------------------------ */

const FILES = [
  {
    name: 'node24.js',
    lang: 'node',
    body: 'export default async function handler(req) {\n  return { status: 200, body_b64 };\n}',
  },
  {
    name: 'handler.py',
    lang: 'python',
    body: 'def handler(request):\n    return {"status": 200,\n            "body_b64": body}',
  },
  {
    name: 'main.go',
    lang: 'go',
    body: 'func main() {\n  in, _ := io.ReadAll(os.Stdin)\n  json.NewEncoder(os.Stdout).Encode(res)\n}',
  },
];

export function FilesMarquee() {
  return (
    <div aria-hidden className={cn('absolute inset-0 pt-6', FADE)}>
      <Marquee pauseOnHover className="[--duration:22s] [--gap:1rem]">
        {FILES.map((file) => (
          <figure
            key={file.name}
            className="relative w-56 cursor-pointer overflow-hidden rounded-xl border border-border bg-background p-4 transition-all duration-300 ease-out hover:border-brand/50"
          >
            <figcaption className="flex items-center justify-between">
              <span className="font-mono text-xs font-medium text-foreground">{file.name}</span>
              <span className="label-mono text-muted-foreground">{file.lang}</span>
            </figcaption>
            <pre className="mt-3 overflow-hidden font-mono text-[10.5px] leading-[1.6] text-muted-foreground">
              {file.body}
            </pre>
          </figure>
        ))}
      </Marquee>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Cron & queues — a week as a 24×7 dot grid, in the DotCut idiom             */
/* ------------------------------------------------------------------------ */

const WEEK_HOURS = [0, 6, 12, 18]; // `0 */6 * * *`
const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function WeekGrid() {
  return (
    <div aria-hidden className={cn('absolute inset-0 px-6 pt-6', FADE)}>
      <div className="mb-3 flex items-center justify-between font-mono text-[11px]">
        <span className="text-foreground">0 */6 * * *</span>
        <span className="text-muted-foreground">nightly-etl · next in 2 h 14 m</span>
      </div>
      <div className="relative">
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-[5px]">
          {DAYS.map((day, d) => (
            <div key={d} className="contents">
              <span className="font-mono text-[9px] leading-[8px] text-muted-foreground">
                {day}
              </span>
              <div className="grid grid-cols-24 gap-[3px]">
                {Array.from({ length: 24 }, (_, h) => {
                  const lit = WEEK_HOURS.includes(h);
                  const now = d === 2 && h === 9;
                  return (
                    <span
                      key={h}
                      className={cn(
                        'aspect-square rounded-full',
                        lit ? 'bg-brand-fill' : 'bg-border',
                        now && 'animate-pulse bg-brand ring-2 ring-brand/30'
                      )}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {/* Sweep: one week, left to right, on a slow loop. */}
        <motion.span
          className="pointer-events-none absolute top-0 bottom-0 left-4 w-8 bg-gradient-to-r from-transparent via-brand-fill/15 to-transparent"
          initial={{ x: '-10%' }}
          animate={{ x: ['-10%', '600%'] }}
          transition={{ duration: 16, ease: 'linear', repeat: Infinity }}
        />
      </div>
      <div className="mt-3 flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
        <span>queue · 3 rows</span>
        <span>·</span>
        <span>dead-letter · 0</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Beams — shared node chip                                                 */
/* ------------------------------------------------------------------------ */

const Node = forwardRef<
  HTMLDivElement,
  { children: ReactNode; className?: string; label?: string; hub?: boolean }
>(({ children, className, label, hub }, ref) => (
  <div className="flex flex-col items-center gap-1.5">
    <div
      ref={ref}
      className={cn(
        'z-10 flex items-center justify-center rounded-full border border-border bg-background shadow-[0_2px_8px_color-mix(in_srgb,var(--foreground)_8%,transparent)]',
        hub ? 'size-14 border-mint-5 bg-mint-2 text-brand' : 'size-10 text-foreground',
        className
      )}
    >
      {children}
    </div>
    {label && <span className="font-mono text-[10px] text-muted-foreground">{label}</span>}
  </div>
));
Node.displayName = 'Node';

/* ------------------------------------------------------------------------ */
/* Deploy from GitHub — ref → build → live                                   */
/* ------------------------------------------------------------------------ */

export function DeployBeam() {
  const containerRef = useRef<HTMLDivElement>(null);
  const a = useRef<HTMLDivElement>(null);
  const b = useRef<HTMLDivElement>(null);
  const c = useRef<HTMLDivElement>(null);

  return (
    <div
      aria-hidden
      ref={containerRef}
      className={cn('absolute inset-0 flex items-start justify-center pt-10', FADE)}
    >
      <div className="flex w-full max-w-[17rem] items-start justify-between px-4">
        <Node ref={a} label="3f9c2e1">
          <GitBranch className="size-4" />
        </Node>
        <Node ref={b} label="bld_9k2f">
          <Package className="size-4" />
        </Node>
        <Node ref={c} label="● running" className="text-status-good">
          <Rocket className="size-4" />
        </Node>
      </div>
      <AnimatedBeam containerRef={containerRef} fromRef={a} toRef={b} duration={4} />
      <AnimatedBeam containerRef={containerRef} fromRef={b} toRef={c} duration={4} delay={1.2} />
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Bring your own state — providers beam into the hub                        */
/* ------------------------------------------------------------------------ */

/** Borderless label nodes: the beams do the drawing, the words just name. */
const CHIP = 'w-auto border-transparent bg-transparent px-2 font-mono text-[11px] shadow-none';

/**
 * The hub breathes: two ring scenes on the same dither engine the hero uses,
 * swapping palette so the disc pulses between light-on-mint and mint-on-light.
 * Module scope — `DotCutCanvas` rebuilds when this array's identity changes.
 */
const HUB_SCENES: Scene[] = [
  { kind: 'rings', transition: 'ripple', palette: 5, style: 'swell' },
  { kind: 'rings', transition: 'ripple', palette: 0, style: 'swell' },
];

export function ProvidersBeam() {
  const containerRef = useRef<HTMLDivElement>(null);
  const hub = useRef<HTMLDivElement>(null);
  // Six named refs rather than an array: the compiler lint (rightly) treats
  // indexing a ref array during render as reading a ref.
  const l0 = useRef<HTMLDivElement>(null);
  const l1 = useRef<HTMLDivElement>(null);
  const l2 = useRef<HTMLDivElement>(null);
  const r0 = useRef<HTMLDivElement>(null);
  const r1 = useRef<HTMLDivElement>(null);
  const r2 = useRef<HTMLDivElement>(null);

  return (
    <div
      aria-hidden
      ref={containerRef}
      className={cn('absolute inset-0 flex items-start justify-center pt-8', FADE)}
    >
      <div className="flex w-full max-w-md items-center justify-between px-8">
        <div className="flex flex-col gap-4">
          <Node ref={l0} className={CHIP}>
            Neon
          </Node>
          <Node ref={l1} className={CHIP}>
            Supabase
          </Node>
          <Node ref={l2} className={CHIP}>
            PlanetScale
          </Node>
        </div>
        <Node ref={hub} hub className="size-20 overflow-hidden border-mint-4 p-0">
          <DotCutCanvas scenes={HUB_SCENES} columns={22} className="h-full w-full" />
        </Node>
        <div className="flex flex-col gap-4">
          <Node ref={r0} className={CHIP}>
            R2
          </Node>
          <Node ref={r1} className={CHIP}>
            Upstash
          </Node>
          <Node ref={r2} className={CHIP}>
            QStash
          </Node>
        </div>
      </div>
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={l0}
        toRef={hub}
        curvature={40}
        duration={5}
        startXOffset={30}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={l1}
        toRef={hub}
        duration={5}
        delay={0.6}
        startXOffset={40}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={l2}
        toRef={hub}
        curvature={-40}
        duration={5}
        delay={1.2}
        startXOffset={46}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={r0}
        toRef={hub}
        curvature={40}
        reverse
        duration={5}
        delay={0.3}
        startXOffset={-22}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={r1}
        toRef={hub}
        reverse
        duration={5}
        delay={0.9}
        startXOffset={-36}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={r2}
        toRef={hub}
        curvature={-40}
        reverse
        duration={5}
        delay={1.5}
        startXOffset={-34}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Logs, metrics, invocations — one wake, as its timeline                     */
/* ------------------------------------------------------------------------ */

/**
 * The shape of `/v1/apps/{slug}/wakes/{id}/timeline`: a single request from
 * arrival to response, segmented. Widths are illustrative of a ~340 ms cold
 * wake; the restore segment is the one that makes this platform what it is.
 */
const WAKE = [
  { label: 'request', ms: 12, tone: 'bg-border-secondary' },
  { label: 'restore snapshot', ms: 214, tone: 'bg-brand-fill' },
  { label: 'boot', ms: 58, tone: 'bg-mint-5' },
  { label: 'handler', ms: 46, tone: 'bg-foreground/70' },
  { label: 'response', ms: 10, tone: 'bg-border-secondary' },
];
const WAKE_TOTAL = WAKE.reduce((n, seg) => n + seg.ms, 0);

const LOG_LINES = [
  'hello  ⟳ waking  x-faas-wake: cold',
  'hello  ● running  GET /  200  340 ms',
  'image-resize  ● running  POST /resize  200  212 ms',
  'nightly-etl  ◌ sleeping  parked at zero',
];

export function WakeTimeline() {
  return (
    <div aria-hidden className={cn('absolute inset-0 px-6 pt-6', FADE)}>
      <div className="rounded-lg border border-border bg-background p-3 shadow-[0_6px_16px_color-mix(in_srgb,var(--foreground)_6%,transparent)]">
        <div className="flex items-center justify-between font-mono text-[11px]">
          <span className="text-foreground">
            wake <span className="text-muted-foreground">wk_2f8a</span>
          </span>
          <span className="text-muted-foreground">{WAKE_TOTAL} ms · cold</span>
        </div>
        <div className="mt-3 flex h-3 w-full gap-px overflow-hidden rounded-sm">
          {WAKE.map((seg, i) => (
            <motion.span
              key={seg.label}
              className={cn('h-full origin-left', seg.tone)}
              style={{ width: `${(seg.ms / WAKE_TOTAL) * 100}%` }}
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 + i * 0.12, ease: EASE }}
            />
          ))}
        </div>
        <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
          <span>0</span>
          <span className="text-brand">restore 214 ms</span>
          <span>{WAKE_TOTAL} ms</span>
        </div>
      </div>
      <pre className="mt-3 px-1 font-mono text-[10.5px] leading-[1.9] text-muted-foreground/70">
        {LOG_LINES.join('\n')}
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Domains & edge rules                                                      */
/* ------------------------------------------------------------------------ */

export function DomainsCard() {
  return (
    <div aria-hidden className={cn('absolute inset-0 px-6 pt-6', FADE)}>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px]">
        <Lock className="size-3 text-status-good" />
        <span className="text-foreground">api.acme.dev</span>
        <span className="ml-auto text-muted-foreground">TLS · managed</span>
      </div>
      <div className="mt-2 rounded-lg border border-border bg-background font-mono text-[11px]">
        {[
          ['/v1/*', '→ hello'],
          ['/hooks/*', '→ webhook-router'],
          ['rule', 'validate · JSON Schema'],
        ].map(([k, v]) => (
          <div
            key={k}
            className="flex justify-between border-b border-border px-3 py-1.5 last:border-0"
          >
            <span className="text-foreground">{k}</span>
            <span className="text-muted-foreground">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Secrets & env                                                             */
/* ------------------------------------------------------------------------ */

const SECRETS = ['DATABASE_URL', 'S3_ACCESS_KEY_ID', 'UPSTASH_REDIS_REST_URL'];

export function SecretsCard() {
  return (
    <div aria-hidden className={cn('absolute inset-0 px-6 pt-6', FADE)}>
      <div className="rounded-lg border border-border bg-background font-mono text-[11px]">
        {SECRETS.map((key) => (
          <div
            key={key}
            className="flex items-center gap-2 border-b border-border px-3 py-2 last:border-0"
          >
            <span className="text-foreground">{key}</span>
            <span className="ml-auto tracking-[0.2em] text-muted-foreground">••••••••</span>
            <span className="rounded-full border border-mint-4 bg-mint-2 px-1.5 text-[9px] text-brand">
              sealed
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 px-1 font-mono text-[10px] text-muted-foreground">
        injected as env at wake · rotate in place
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Preview environments — fanned PR cards                                    */
/* ------------------------------------------------------------------------ */

const PRS = [
  { n: 42, branch: 'feat/resize', rot: '-rotate-3 -translate-x-2', z: 'z-0' },
  { n: 43, branch: 'fix/retry', rot: 'rotate-0', z: 'z-10' },
];

export function PreviewsCard() {
  return (
    <div aria-hidden className={cn('absolute inset-0', FADE)}>
      {PRS.map((pr, i) => (
        <div
          key={pr.n}
          className={cn(
            'absolute left-8 right-8 rounded-lg border border-border bg-background p-3 font-mono text-[11px] shadow-[0_6px_16px_color-mix(in_srgb,var(--foreground)_6%,transparent)] transition-transform duration-300',
            pr.rot,
            pr.z,
            i === 0 ? 'top-7' : 'top-12 group-hover:translate-y-1'
          )}
        >
          <div className="flex items-center gap-2">
            <GitPullRequest className="size-3 text-brand" />
            <span className="text-foreground">#{pr.n}</span>
            <span className="text-muted-foreground">{pr.branch}</span>
          </div>
          <p className="mt-2 truncate text-muted-foreground">pr-{pr.n}.hello.apps.gregale.dev</p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Locked down by default — checks that land one by one                      */
/* ------------------------------------------------------------------------ */

const CHECKS = [
  'egress: deny by default',
  'secret scan: 0 findings',
  'SBOM + provenance attached',
  'audit log: every write',
];

export function ChecksCard() {
  return (
    <div aria-hidden className={cn('absolute inset-0 px-6 pt-6', FADE)}>
      <ul className="rounded-lg border border-border bg-background font-mono text-[11px]">
        {CHECKS.map((check, i) => (
          <motion.li
            key={check}
            initial={{ opacity: 0, x: -6 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.3 + i * 0.18, ease: EASE }}
            className="flex items-center gap-2 border-b border-border px-3 py-2 last:border-0"
          >
            <Check className="size-3 text-status-good" />
            <span className="text-foreground">{check}</span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
