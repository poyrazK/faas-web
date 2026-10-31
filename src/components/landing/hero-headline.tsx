import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useInView } from 'motion/react';
import './hero-headline.css';

const CAPABILITIES = [
  { text: 'APIs that wake on demand.', availability: 'Public beta' },
  { text: 'services that work together.', availability: 'Preview' },
  { text: 'background jobs that retry.', availability: 'Preview' },
  { text: 'workflows that wait and resume.', availability: 'Preview' },
  { text: 'webhooks that wake your app.', availability: 'Preview' },
  { text: 'MCP servers for your agents.', availability: 'Preview' },
  { text: 'previews before you merge.', availability: 'Public beta' },
  { text: 'code runs in isolated microVMs.', availability: 'Preview' },
] as const;

const subscribeMotion = (notify: () => void) => {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};
const subscribeVisibility = (notify: () => void) => {
  document.addEventListener('visibilitychange', notify);
  return () => document.removeEventListener('visibilitychange', notify);
};

export function HeroHeadline() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { initial: true, amount: 0.1 });
  const reduce = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => true
  );
  const visible = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== 'hidden',
    () => true
  );
  const [paused, setPaused] = useState(false);
  const [step, setStep] = useState(0);
  const index = step % CAPABILITIES.length;
  const currentPhrase = useRef<HTMLSpanElement>(null);
  const previousPhrase = useRef<HTMLSpanElement>(null);
  const lastAnimatedStep = useRef(0);
  const capability = CAPABILITIES[index];
  const animated = !reduce && !paused && visible && inView;

  useEffect(() => {
    if (reduce || paused || !visible || !inView) return;
    const timer = window.setTimeout(() => setStep((current) => current + 1), 5200);
    return () => window.clearTimeout(timer);
  }, [step, reduce, paused, visible, inView]);

  useLayoutEffect(() => {
    const current = currentPhrase.current;
    const previous = previousPhrase.current;
    if (!animated || step === lastAnimatedStep.current || !current?.animate || !previous) return;
    lastAnimatedStep.current = step;

    // Whole phrases share one direction, with a quiet handoff between them.
    // The outgoing line accelerates away; the incoming line settles gradually.
    const departure = previous.animate(
      [
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(-0.18em)' },
      ],
      { duration: 320, easing: 'cubic-bezier(0.4, 0, 1, 1)' }
    );
    const arrival = current.animate(
      [{ transform: 'translateY(0.28em)' }, { transform: 'translateY(0)' }],
      { duration: 1000, easing: 'cubic-bezier(0.22, 0.8, 0.25, 1)' }
    );
    const reveal = current.animate([{ opacity: 0 }, { opacity: 1 }], {
      delay: 200,
      duration: 420,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      fill: 'backwards',
    });
    return () => {
      // Cancelling restores the crisp resting styles immediately on pause,
      // reduced motion, tab hiding, or leaving the viewport.
      departure.cancel();
      arrival.cancel();
      reveal.cancel();
    };
  }, [step, animated]);

  return (
    <div ref={ref} className="hero-headline w-full">
      <h1
        aria-label="Next-generation cloud for APIs, services, background jobs, workflows, webhooks, MCP servers, previews and isolated code runs."
        className="animate-hero-enter relative text-[40px] font-semibold leading-[1.04] tracking-[-0.055em] text-[#212121] sm:text-[58px] lg:text-[62px]"
        style={{ animationDelay: '0.06s' }}
      >
        <span aria-hidden="true" className="block text-balance">
          Next-generation cloud for
        </span>
        <span aria-hidden="true" className="hero-capability-slot">
          {/* Measure every phrase at this exact viewport/font size, reserving the
              tallest one. Transitions cannot move the copy, actions or terminal. */}
          {CAPABILITIES.map((item) => (
            <span key={item.text} className="hero-capability-measure hero-capability-text">
              {item.text}
            </span>
          ))}
          <span ref={previousPhrase} className="hero-capability-previous hero-capability-text">
            {CAPABILITIES[(index + CAPABILITIES.length - 1) % CAPABILITIES.length].text}
          </span>
          <span ref={currentPhrase} className="hero-capability-text" data-testid="hero-capability">
            {capability.text}
          </span>
        </span>
      </h1>
      {/* Keep a keyboard-accessible pause action without a visible control row. */}
      {!reduce && (
        <button
          type="button"
          className="hero-animation-toggle"
          onClick={() => setPaused((current) => !current)}
          aria-label={paused ? 'Resume headline animation' : 'Pause headline animation'}
        >
          {paused ? 'Resume headline animation' : 'Pause headline animation'}
        </button>
      )}
    </div>
  );
}
