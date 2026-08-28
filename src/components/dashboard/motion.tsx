import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';

/**
 * Console micro-motion — one small vocabulary the whole dashboard shares.
 *
 * Every entrance is a short rise-and-fade on the same curve the marketing
 * page uses, kept under 400ms so it reads as "the page settling", never as
 * a show. Everything here honours `prefers-reduced-motion`: reduced users
 * get the final state immediately.
 */

/** The console curve. Mirrored in CSS as `--motion-ease` / `ease-console`
 * (index.css) — change one, change both. */
export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const DURATION = 0.38;
/** Standard press feedback for anything button-shaped. CSS-only consumers
 * use the `.pressable` class instead. */
export const TAP = { scale: 0.97 } as const;

/**
 * The entrance every staggered child shares.
 *
 * **Only for content whose mount timing the `<Stagger>` controls.** A variant
 * child that mounts after the parent has finished its entrance — a
 * code-split route landing, a panel appearing once data arrives — is left at
 * `hidden` (opacity 0) forever, because nothing re-runs the orchestration.
 * The shared page components (PageHeader, Panel, StatTile, ResourceTable)
 * therefore use the CSS `animate-item-enter` mount animation instead, which
 * replays on every DOM insertion. Reach for Stagger only when every child
 * mounts in the same commit as the Stagger itself.
 */
const item = {
  // From the northeast, like every entrance in the console — a gregale is a
  // northeast wind. Mirrors the CSS `item-enter` keyframe.
  hidden: { opacity: 0, x: 12, y: -8 },
  show: { opacity: 1, x: 0, y: 0, transition: { duration: DURATION, ease: EASE } },
};

/** Staggered entrance for a group of siblings — wrap the group, mark each
 * child with `<Item>`. Reduced motion renders children in place. */
export function Stagger({
  children,
  className,
  delay = 0,
  step = 0.045,
  ...rest
}: ComponentProps<typeof motion.div> & { delay?: number; step?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : 'hidden'}
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: step, delayChildren: delay } },
      }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** `<ul>` flavour of `<Stagger>` so list markup stays semantic. */
export function StaggerUl({
  children,
  className,
  delay = 0,
  step = 0.045,
  ...rest
}: ComponentProps<typeof motion.ul> & { delay?: number; step?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.ul
      className={className}
      initial={reduce ? false : 'hidden'}
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: step, delayChildren: delay } },
      }}
      {...rest}
    >
      {children}
    </motion.ul>
  );
}

/** One child of a `<Stagger>` — a section, tile, or row. */
export function Item({ children, className, ...rest }: ComponentProps<typeof motion.div>) {
  return (
    <motion.div className={className} variants={item} {...rest}>
      {children}
    </motion.div>
  );
}

/** List-item flavour of `<Item>` for `<ul>` children. */
export function ItemLi({ children, className, ...rest }: ComponentProps<typeof motion.li>) {
  return (
    <motion.li className={className} variants={item} {...rest}>
      {children}
    </motion.li>
  );
}

/**
 * Number that rolls to its new value instead of jumping. `format` turns the
 * live value into text; keep it monotone (compact/fixed) so width settles.
 * Snaps on first paint and under reduced motion — the roll is for *changes*.
 */
export function CountUp({
  value,
  format = (v) => Math.round(v).toLocaleString(),
  className,
}: {
  value: number;
  format?: (v: number) => string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const spring = useSpring(mv, { stiffness: 170, damping: 26, mass: 0.6 });
  const text = useTransform(spring, (v) => format(v));
  const [display, setDisplay] = useState(() => format(value));

  useEffect(() => {
    if (reduce) {
      spring.jump(value);
      setDisplay(format(value));
      return;
    }
    mv.set(value);
  }, [value, reduce, mv, spring, format]);

  useEffect(() => text.on('change', setDisplay), [text]);

  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {display}
    </span>
  );
}

/** Wraps a block so it can be keyed and cross-faded when its content swaps
 * (e.g. a range change) without unmounting the shell around it. */
export function Swap({ children, id }: { children: ReactNode; id: string | number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={id}
      initial={reduce ? false : { opacity: 0, x: 6, y: -4 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
