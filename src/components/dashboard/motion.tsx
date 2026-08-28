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
 * The entrance every staggered child shares. Exported so a component that is
 * not a plain div (a `<section>`, a stat tile) can join a surrounding
 * `<Stagger>` by putting these variants on its own motion element. Outside a
 * `<Stagger>` the variants never activate and the element renders static —
 * safe to leave on shared components.
 */
export const ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: DURATION, ease: EASE } },
};

const item = ITEM_VARIANTS;

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
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
