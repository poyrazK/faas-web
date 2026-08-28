import { motion, useInView, useReducedMotion } from 'motion/react';
import { Fragment, useRef, type ElementType } from 'react';
import { EASE } from './reveal';

/**
 * Word-by-word reveal: each word sits inside its own clipping box and rises
 * into it, so the line assembles from behind an edge rather than fading in
 * as a block. A little blur burns off as it lands, which softens the arrival
 * and keeps the stagger from reading as mechanical.
 *
 * Segments let one heading mix styles — a bright clause and a muted one —
 * without losing per-word timing across the whole line.
 */

export interface RevealSegment {
  text: string;
  className?: string;
}

interface TextRevealProps {
  segments: RevealSegment[];
  className?: string;
  /** Element to render. Headings should pass their real level. */
  as?: ElementType;
  /** Seconds before the first word moves. */
  delay?: number;
  /** Seconds between consecutive words. */
  stagger?: number;
}

const HIDDEN = { y: '115%', opacity: 0, filter: 'blur(6px)' };
const SHOWN = { y: '0%', opacity: 1, filter: 'blur(0px)' };

export function TextReveal({
  segments,
  className = '',
  as: Tag = 'h2',
  delay = 0,
  stagger = 0.032,
}: TextRevealProps) {
  const reduceMotion = useReducedMotion();

  // One observer on the heading itself, not one per word. The words start
  // translated fully outside their overflow-hidden clip boxes, and
  // IntersectionObserver clips a target by its ancestors' overflow — so a
  // per-word `whileInView` never sees the word intersect and the heading
  // stays parked at opacity 0 (selectable, invisible). Watching the block
  // element side-steps that entirely.
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px 0px' });

  const words = segments.flatMap((segment) =>
    segment.text
      .split(' ')
      .filter(Boolean)
      .map((word) => ({ word, className: segment.className ?? '' }))
  );

  // Reduced motion still gets the styling, just none of the movement.
  if (reduceMotion) {
    return (
      <Tag className={className}>
        {words.map(({ word, className: wc }, i) => (
          <span key={i} className={wc}>
            {word}
            {i < words.length - 1 ? ' ' : ''}
          </span>
        ))}
      </Tag>
    );
  }

  return (
    <Tag ref={ref} className={className}>
      {words.map(({ word, className: wordClass }, i) => (
        <Fragment key={i}>
          <span
            // The clip box needs room below the baseline or descenders get
            // shaved; the negative margin gives it back to the line box.
            className="inline-block overflow-hidden pb-[0.14em] align-bottom -mb-[0.14em]"
          >
            <motion.span
              className={`inline-block ${wordClass}`}
              initial={HIDDEN}
              animate={inView ? SHOWN : HIDDEN}
              transition={{
                duration: 0.85,
                delay: delay + i * stagger,
                ease: EASE,
              }}
            >
              {word}
            </motion.span>
          </span>
          {/* The separator has to live BETWEEN the clip boxes, not inside one.
              Held inside, it was a non-breaking space enclosed in an
              inline-block, so consecutive words were glued with no soft-wrap
              opportunity anywhere and the heading became a single unbreakable
              line — which then overflowed and was clipped by the section's
              own overflow-hidden. A plain space here is a real break
              opportunity, so the heading wraps again. */}
          {i < words.length - 1 && ' '}
        </Fragment>
      ))}
    </Tag>
  );
}
