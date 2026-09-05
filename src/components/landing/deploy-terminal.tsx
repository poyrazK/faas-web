import { useEffect, useRef, useState } from 'react';
import { Restart } from 'iconoir-react';

/**
 * A deploy session, typed out.
 *
 * Every line is something the product actually prints. The deploy command and
 * its one-line reply are the worked example from `content/docs/deploy-from-
 * source.md`; the `x-faas-wake: cold` header and the ~350 ms wake are from
 * `content/docs/scale-to-zero.md`; `*.apps.gregale.dev` is the zone from
 * `preview-environments.md`. Change those docs, change this script.
 *
 * What it is not: a live call. The timings are illustrative of the documented
 * p50, not measured in the visitor's browser — the caption says so.
 */
type Line =
  | { kind: 'cmd'; text: string }
  | { kind: 'out'; text: string; tone?: 'dim' | 'brand'; note?: string }
  | { kind: 'gap' };

const SCRIPT: Line[] = [
  { kind: 'cmd', text: 'gregale deploy --repo onebox-faas/hello --ref main' },
  {
    kind: 'out',
    text: 'Deployed hello from onebox-faas/hello@3f9c2e1 (build bld_9k2f, deployment dep_4q7x)',
  },
  { kind: 'gap' },
  {
    kind: 'cmd',
    text: "curl -sD - -o /dev/null -w 'total %{time_total}s\\n' https://hello.apps.gregale.dev/",
  },
  { kind: 'out', text: 'HTTP/2 200', tone: 'dim' },
  { kind: 'out', text: 'x-faas-wake: cold', tone: 'brand', note: 'snapshot restored' },
  { kind: 'out', text: 'total 0.338s' },
  { kind: 'gap' },
  {
    kind: 'cmd',
    text: "curl -sD - -o /dev/null -w 'total %{time_total}s\\n' https://hello.apps.gregale.dev/",
  },
  { kind: 'out', text: 'HTTP/2 200', tone: 'dim' },
  { kind: 'out', text: 'total 0.019s', note: 'warm instance' },
  { kind: 'gap' },
  {
    kind: 'out',
    text: '# idle → parked back at zero. Nothing resident, nothing billed, until the next request.',
    tone: 'dim',
  },
];

/** Playback is chunked to 20 React updates/sec instead of one per character. */
const TYPE_MS = 50;
const CHARS_PER_TICK = 2;
const RUN_MS = 520;
const OUT_MS = 120;

/**
 * Playback position. `line` is the index of the line being revealed; `chars`
 * is how much of it is visible. Lines before `line` are fully shown.
 */
interface Cursor {
  line: number;
  chars: number;
  done: boolean;
}

const START: Cursor = { line: 0, chars: 0, done: false };
const END: Cursor = { line: SCRIPT.length, chars: 0, done: true };

export function DeployTerminal() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<Cursor>(START);
  const [armed, setArmed] = useState(false);
  const [run, setRun] = useState(0);

  // Start when the card scrolls into view, not on mount: the hero is the
  // first thing painted, and a session that finished before the reader got
  // to it is just a block of text.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setArmed(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    io.observe(host);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!armed) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let pos: Cursor = { ...START };

    const step = () => {
      if (pos.line >= SCRIPT.length) {
        pos = END;
        setCursor(pos);
        return;
      }
      const current = SCRIPT[pos.line];
      let wait: number;
      if (current.kind === 'cmd' && pos.chars < current.text.length) {
        pos = { ...pos, chars: Math.min(current.text.length, pos.chars + CHARS_PER_TICK) };
        wait = TYPE_MS;
      } else {
        // Line complete: a command "runs" before its output shows.
        wait = current.kind === 'cmd' ? RUN_MS : current.kind === 'gap' ? 40 : OUT_MS;
        pos = { line: pos.line + 1, chars: 0, done: false };
      }
      setCursor(pos);
      timer = setTimeout(step, wait);
    };

    // Do not compete with the hero's LCP work. Playback starts in an idle
    // period after the terminal is substantially visible; replay uses the
    // same scheduler. Reduced motion still reveals everything immediately.
    let idle: number | undefined;
    if (reduced) {
      timer = setTimeout(() => setCursor(END), 0);
    } else if ('requestIdleCallback' in window) {
      idle = window.requestIdleCallback(
        () => {
          timer = setTimeout(step, 250);
        },
        { timeout: 2_000 }
      );
    } else {
      timer = setTimeout(step, 750);
    }
    return () => {
      if (timer) clearTimeout(timer);
      if (idle !== undefined && 'cancelIdleCallback' in window) window.cancelIdleCallback(idle);
    };
  }, [armed, run]);

  return (
    <div
      ref={hostRef}
      className="console relative overflow-hidden rounded-xl border border-border bg-card text-left text-foreground shadow-2xl shadow-mint-12/15"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-border-secondary" />
            <span className="h-2.5 w-2.5 rounded-full bg-border-secondary" />
            <span className="h-2.5 w-2.5 rounded-full bg-border-secondary" />
          </div>
          <span className="font-mono text-xs text-muted-foreground">hello — zsh</span>
        </div>
        <button
          type="button"
          onClick={() => {
            setCursor(START);
            setRun((n) => n + 1);
          }}
          aria-label="Replay the session"
          className={`flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground ${
            cursor.done ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <Restart className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Sized by an invisible copy of the finished session, so the card has
          its final height from the first frame at every width — nothing grows
          line by line and shoves the page while it types. */}
      <div className="relative">
        <pre
          aria-hidden
          className="invisible m-0 whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-[1.7] sm:p-5 sm:text-[13px]"
        >
          <Session cursor={END} />
        </pre>
        <pre
          aria-label="Example deploy session"
          className="absolute inset-0 m-0 overflow-hidden whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-[1.7] sm:p-5 sm:text-[13px]"
        >
          <Session cursor={cursor} />
        </pre>
      </div>
    </div>
  );
}

function Session({ cursor }: { cursor: Cursor }) {
  return (
    <>
      {SCRIPT.map((line, i) => {
        if (i > cursor.line) return null;
        const partial = i === cursor.line && !cursor.done;
        if (line.kind === 'gap')
          return (
            <span key={i} className="block">
              {' '}
            </span>
          );
        if (line.kind === 'cmd') {
          const text = partial ? line.text.slice(0, cursor.chars) : line.text;
          return (
            <span key={i} className="block">
              <span className="text-brand">$ </span>
              <span>{text}</span>
              {partial && <Caret />}
            </span>
          );
        }
        // Output lines land whole; a partially revealed one is simply hidden.
        if (partial) return null;
        return (
          <span
            key={i}
            className={`block ${
              line.tone === 'dim'
                ? 'text-muted-foreground'
                : line.tone === 'brand'
                  ? 'text-brand'
                  : ''
            }`}
          >
            {line.text}
            {line.note && (
              <span className="text-muted-foreground">
                {'   '}
                <span aria-hidden>← </span>
                {line.note}
              </span>
            )}
          </span>
        );
      })}
      {cursor.done && (
        <span className="block">
          <span className="text-brand">$ </span>
          <Caret />
        </span>
      )}
    </>
  );
}

function Caret() {
  return (
    <span
      aria-hidden
      className="ml-px inline-block h-[1.1em] w-[0.55em] translate-y-[0.2em] animate-pulse bg-brand/80 motion-reduce:animate-none"
    />
  );
}
