/**
 * A single point of mint light patrolling a card's border — the "border
 * beam" pattern (Magic UI), redrawn from scratch in the console's tokens and
 * slowed from a sparkle to a patrol. Drop inside any `relative overflow-
 * hidden rounded-*` container; one card per page, or it stops meaning
 * anything. Decorative: hidden from AT, and the reduced-motion blanket rule
 * stops the loop (a static beam degrades to an invisible sliver, i.e. a
 * plain border).
 */
export function BorderBeam() {
  return (
    <div
      aria-hidden
      className="border-beam-ring animate-border-beam pointer-events-none absolute inset-0 rounded-[inherit]"
    />
  );
}
