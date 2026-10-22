import { useEffect, useRef, useState } from 'react';

/**
 * Shared WebGL plumbing for the site's background shaders.
 *
 * Handles context creation, compilation, the fullscreen draw, resizing at a
 * fractional render scale, pointer tracking, pausing offscreen and when the
 * tab hides, a single static frame under reduced motion, and full teardown.
 *
 * Every shader gets `u_res`, `u_time`, and `u_pointer` for free; anything
 * else is declared via `uniformNames` and written in `onFrame`.
 */

const VERT = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export type UniformMap = Record<string, WebGLUniformLocation | null>;

interface Options {
  frag: string;
  /** Prefix for console warnings, so failures name their shader. */
  label: string;
  /** Internal resolution multiplier. Below 1 for cost and chunkier pixels. */
  renderScale?: number;
  /** Extra uniforms to look up, beyond the three standard ones. */
  uniformNames?: readonly string[];
  /** Runs each frame to write the extra uniforms. */
  onFrame?: (gl: WebGLRenderingContext, uniforms: UniformMap) => void;
}

function compile(
  gl: WebGLRenderingContext,
  type: number,
  src: string,
  label: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) {
    // Never fail silently here: a null shader usually means the context is
    // lost, which otherwise just shows the fallback with no explanation.
    console.warn(
      `[${label}] could not create shader` +
        (gl.isContextLost() ? ' — the WebGL context is lost' : '')
    );
    return null;
  }
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn(`[${label}] shader compile failed:`, gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function useShaderCanvas({
  frag,
  label,
  renderScale = 0.55,
  uniformNames = [],
  onFrame,
}: Options) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [supported, setSupported] = useState(true);

  // Read the callback through a ref so a new closure each render never tears
  // down and rebuilds the GL context.
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const names = uniformNames.join(',');

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const gl = (canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
    }) || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;

    if (!gl) {
      setSupported(false);
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT, label);
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag, label);
    if (!vs || !fs) {
      setSupported(false);
      return;
    }

    const program = gl.createProgram();
    if (!program) {
      setSupported(false);
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn(`[${label}] link failed:`, gl.getProgramInfoLog(program));
      setSupported(false);
      return;
    }
    gl.useProgram(program);

    // One oversized triangle covers the clip volume — cheaper than a quad and
    // free of the diagonal seam two triangles can show.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, 'u_res');
    const uTime = gl.getUniformLocation(program, 'u_time');
    const uPointer = gl.getUniformLocation(program, 'u_pointer');

    const extra: UniformMap = {};
    for (const name of names ? names.split(',') : []) {
      extra[name] = gl.getUniformLocation(program, name);
    }

    const pointer = { x: -9999, y: -9999 };
    let raf = 0;
    let running = false;
    let start = performance.now();
    let onscreen = true;
    let pageVisible = document.visibilityState === 'visible';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    const resize = () => {
      const w = Math.max(1, Math.round(host.clientWidth * renderScale));
      const h = Math.max(1, Math.round(host.clientHeight * renderScale));
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    };

    const draw = (elapsedMs: number) => {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, elapsedMs / 1000);
      gl.uniform2f(uPointer, pointer.x * renderScale, pointer.y * renderScale);
      onFrameRef.current?.(gl, extra);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const tick = (now: number) => {
      if (!running) return;
      draw(now - start);
      raf = requestAnimationFrame(tick);
    };

    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const sync = () => {
      if (reduced.matches) {
        stop();
        resize();
        draw(0); // one static frame
        return;
      }
      if (onscreen && pageVisible) {
        if (!running) {
          running = true;
          start = performance.now() - 1;
          raf = requestAnimationFrame(tick);
        }
      } else {
        stop();
      }
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (!running) draw(0);
    });
    ro.observe(host);

    const io = new IntersectionObserver(([entry]) => {
      onscreen = entry.isIntersecting;
      sync();
    });
    io.observe(host);

    const onVisibility = () => {
      pageVisible = document.visibilityState === 'visible';
      sync();
    };
    document.addEventListener('visibilitychange', onVisibility);
    reduced.addEventListener('change', sync);

    const onPointerMove = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      // GL's origin is bottom-left; the DOM's is top-left.
      pointer.x = e.clientX - rect.left;
      pointer.y = rect.height - (e.clientY - rect.top);
    };
    const onPointerLeave = () => {
      pointer.x = -9999;
      pointer.y = -9999;
    };
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerleave', onPointerLeave);

    // A lost context cannot be drawn to; stop instead of spewing GL errors.
    const onLost = (e: Event) => {
      e.preventDefault();
      stop();
    };
    canvas.addEventListener('webglcontextlost', onLost);

    sync();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener('change', sync);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('webglcontextlost', onLost);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      // Deliberately NOT calling WEBGL_lose_context.loseContext(): a canvas
      // hands back the same context object on the next getContext(), and a
      // lost one can never be revived. Under StrictMode's mount → cleanup →
      // mount cycle that permanently breaks the second mount. Deleting the
      // program, shaders, and buffer already releases the GPU resources;
      // the context goes when the canvas is collected.
    };
  }, [frag, label, renderScale, names]);

  return { hostRef, canvasRef, supported };
}

/** GLSL shared by the shaders: precision guard and the Bayer dither ladder. */
export const GLSL_PRELUDE = `
// Hashes fold values into the hundreds before fract(); mediump (10-bit
// mantissa, ±16384 guaranteed) shows visible artifacts there on mobile GPUs.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2  u_res;
uniform float u_time;
uniform vec2  u_pointer;

// Ordered Bayer thresholds from the 2x2 base pattern. Each level is periodic,
// so callers wrap to the 8x8 tile before squaring — a raw fragment coordinate
// would overflow mediump here.
float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(a * 0.5) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(a * 0.5) * 0.25 + bayer2(a); }
`;
