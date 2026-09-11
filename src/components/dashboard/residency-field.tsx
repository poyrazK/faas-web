import { useEffect, useMemo, useRef } from 'react';
import {
  GLSL_PRELUDE,
  useShaderCanvas,
  type UniformMap,
} from '@/components/landing/shaders/use-shader-canvas';

/**
 * The fleet's resident RAM, as a field.
 *
 * Every other shader in the tree is weather — this one is a reading. One cell
 * per resident instance, its **area proportional to that instance's `ram_mb`**
 * at a fixed drawing scale, so the field is a true portrait of what the fleet
 * is holding rather than an impression of it.
 *
 * It shows the thing no other platform's dashboard can. Gregale parks to zero,
 * so the field genuinely empties: a cell dissolves when the reaper parks an app
 * and condenses when one wakes. A console for always-on servers has no way to
 * render absence, because nothing is ever absent.
 *
 * It deliberately makes **no capacity claim**. The obvious framing — this much
 * of the 47,600 MB admission ceiling — cannot be drawn honestly here:
 * `/v1/compute-nodes` is an operator route, no customer endpoint returns
 * `admission_ceiling_mb`, and on a multi-node fleet the ceiling is the sum of
 * per-node ceilings anyway. A roof on this panel would be a number the API
 * never confirmed. The field shows what is resident, and implies nothing about
 * what fits.
 *
 * Positions are hashed from the instance id, so a cell keeps its place when the
 * poll returns the list in a different order — the field settles rather than
 * reshuffling every ten seconds.
 *
 * Rides the shared shader plumbing: pauses offscreen and when the tab hides,
 * renders one still frame under reduced motion, and draws nothing at all when
 * WebGL is unavailable — the figures it portrays are written out beside it.
 */

/** Cells the shader will draw. A fragment loop needs a constant bound, and a
 *  single node's tenant budget divided by the smallest plan lands far above
 *  what is legible anyway — past this the field is a texture, not a count. */
const MAX_CELLS = 40;
/** How long a cell takes to condense on wake or dissolve on park. */
const TRANSITION_MS = 600;

export interface ResidencyInstance {
  id: string;
  ram_mb: number;
}

const FRAG = `${GLSL_PRELUDE}

uniform vec4  u_cells[${MAX_CELLS}];  // xy centre (0..1), z radius, w energy
uniform float u_count;

// The mint ramp, matching --mint-7 and --mint-9 in index.css. A shader cannot
// read a custom property, so these are the one place the console's brand is
// restated; if the ramp moves, move them with it.
const vec3 MINT_LO = vec3(0.318, 0.871, 0.667);
const vec3 MINT_HI = vec3(0.000, 0.808, 0.569);

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * aspect, uv.y);

  // Accumulate every cell's soft falloff into one field, so neighbours merge
  // instead of overlapping as discs — a fleet reads as one body under load.
  float field = 0.0;
  for (int i = 0; i < ${MAX_CELLS}; i++) {
    if (float(i) >= u_count) break;
    vec4 c = u_cells[i];
    vec2 d = p - vec2(c.x * aspect, c.y);
    float r = max(c.z, 0.0001);
    field += (1.0 - smoothstep(r * 0.30, r, length(d))) * c.w;
  }

  // The gregale: a slow drift from the northeast, carried in the dither's
  // sampling rather than in the cells, so the reading stays still while the
  // texture over it moves.
  vec2 drift = vec2(-0.35, -0.45) * u_time * 6.0;
  float threshold = bayer8(mod(gl_FragCoord.xy + drift, 8.0));

  // Quantise into four steps. The field is a measurement, and a continuous
  // gradient invites reading precision that is not there; steps say "about
  // this much" honestly, and match the dither language the charts already use.
  float lit = clamp(field, 0.0, 1.0);
  float stepped = floor(lit * 4.0 + threshold * 0.85) / 4.0;

  // Hue never carries state here: there is no threshold this panel can know,
  // so the ramp is depth only — more resident memory under a fragment, deeper
  // mint. Anything else would be inventing a status.
  vec3 col = mix(MINT_LO, MINT_HI, clamp(field * 0.6, 0.0, 1.0));
  gl_FragColor = vec4(col, stepped * 0.85);
}
`;

interface Cell {
  /** Stable across polls: hashed from the instance id. */
  x: number;
  y: number;
  /** Share of the fleet's resident RAM this instance holds. */
  weight: number;
  /** Wall-clock of the birth or death that is currently animating. */
  since: number;
  leaving: boolean;
}

/** Deterministic 0..1 pair from an instance id — FNV-1a, folded to two axes. */
function placeById(id: string): { x: number; y: number } {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Inset from the edges so a cell is never half-clipped by the panel.
  return { x: 0.08 + (((h >>> 8) % 1000) / 1000) * 0.84, y: 0.12 + ((h % 1000) / 1000) * 0.76 };
}

/**
 * Panel area one megabyte of resident RAM draws.
 *
 * A drawing scale, not a budget: it sets how big a 512 MB instance looks, and
 * nothing here claims to know how many of them fit. Tuned so a handful of
 * typical instances read as a body rather than as specks.
 */
const AREA_PER_MB = 0.000045;

export function ResidencyField({
  instances,
  className,
}: {
  instances: ResidencyInstance[];
  className?: string;
}) {
  const cells = useRef(new Map<string, Cell>());
  const buffer = useRef(new Float32Array(MAX_CELLS * 4));

  const residentMb = useMemo(
    () => instances.reduce((sum, row) => sum + row.ram_mb, 0),
    [instances]
  );

  // Reconcile the registry against the newest poll, after commit rather than
  // during render.
  //
  // This began as straight-line code in the render body, which is a real bug
  // and not only a lint complaint: births and deaths are stamped with the wall
  // clock, and StrictMode's double render would stamp each one twice, easing
  // cells from the wrong instant. An effect runs once per committed change,
  // which is exactly the cadence a registry of live things wants.
  useEffect(() => {
    const now = Date.now();
    const total = instances.reduce((sum, row) => sum + row.ram_mb, 0);
    const live = new Set(instances.map((row) => row.id));
    const registry = cells.current;

    for (const row of instances) {
      const existing = registry.get(row.id);
      const weight = total > 0 ? row.ram_mb / total : 0;
      if (!existing) {
        registry.set(row.id, { ...placeById(row.id), weight, since: now, leaving: false });
        continue;
      }
      existing.weight = weight;
      if (existing.leaving) {
        // It came back before it finished dissolving — condense it again from
        // wherever it had faded to, rather than restarting from nothing.
        existing.leaving = false;
        existing.since = now;
      }
    }

    for (const [id, cell] of registry) {
      if (live.has(id)) continue;
      if (!cell.leaving) {
        cell.leaving = true;
        cell.since = now;
      } else if (now - cell.since > TRANSITION_MS) {
        registry.delete(id);
      }
    }
  }, [instances]);

  const onFrame = (gl: WebGLRenderingContext, uniforms: UniformMap) => {
    const at = Date.now();
    const data = buffer.current;
    data.fill(0);
    let i = 0;
    // Area is what the eye compares, so the radius is the square root of the
    // megabytes, not the megabytes. Clamped so a very large fleet saturates
    // the panel instead of drawing cells past its edges.
    const totalArea = Math.min(residentMb * AREA_PER_MB, 0.72);
    const areaBudget = totalArea;
    for (const cell of cells.current.values()) {
      if (i >= MAX_CELLS) break;
      const t = Math.min((at - cell.since) / TRANSITION_MS, 1);
      const ease = cell.leaving ? 1 - t * t : 1 - (1 - t) * (1 - t);
      const radius = Math.sqrt(Math.max(cell.weight, 0) * areaBudget) * ease;
      data[i * 4] = cell.x;
      data[i * 4 + 1] = cell.y;
      data[i * 4 + 2] = radius;
      data[i * 4 + 3] = ease;
      i++;
    }
    // Keyed by the exact string handed to `uniformNames`, and an array uniform
    // is looked up by its first element — writing from that location fills the
    // whole array.
    const cellsLoc = uniforms['u_cells[0]'];
    if (cellsLoc) gl.uniform4fv(cellsLoc, data);
    if (uniforms.u_count) gl.uniform1f(uniforms.u_count, i);
  };

  const { hostRef, canvasRef, supported } = useShaderCanvas({
    frag: FRAG,
    label: 'residency-field',
    renderScale: 0.5,
    uniformNames: ['u_cells[0]', 'u_count'],
    onFrame,
  });

  return (
    <div ref={hostRef} className={className} aria-hidden="true">
      {/* No WebGL, nothing drawn. The figures this field portrays are written
          out beside it, so what is lost is the picture and not the reading —
          which is why there is no substitute shape here pretending to be one. */}
      {supported && <canvas ref={canvasRef} className="h-full w-full" />}
    </div>
  );
}
