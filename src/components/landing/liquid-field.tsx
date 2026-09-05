import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { FRAG_MAIN, FRAG_PUSH, VERT } from './liquid-shaders';

/**
 * The liquid light field, as a component.
 *
 * Runs the recovered WaitlistKit shader in WebGL2: a half-resolution ping-pong
 * pass accumulates the cursor's motion into a "push" texture; the main pass
 * reads it and paints the gradient. `u_time` advances in real seconds, as the
 * original does, so the same `params` reproduce the same picture.
 *
 * Every uniform is a field of `params`; `LIQUID_PRESETS.gregale` is what the
 * site runs. Pauses off-screen and when the tab is hidden; under reduced motion it
 * draws one frame and stops. Without WebGL2 it paints a static gradient in
 * the palette's colours so the page never goes blank.
 */

export interface LiquidParams {
  /** 1–8 hex colours, the palette ramp from low to high. */
  colors: string[];
  seed: number;
  speed: number;
  /** Loop length in seconds; 0 = free-running. */
  loop: number;
  /** Pattern scale — lower is larger, calmer shapes; higher is denser. */
  scale: number;
  turbAmp: number;
  turbFreq: number;
  /** Turbulence iterations, 2–12. More = more detail, more cost. */
  turbIter: number;
  waveFreq: number;
  distBias: number;
  jellify: boolean;
  mousePush: number;
  mouseRadius: number;
  mouseStretch: number;
  mousePersist: number;
  /** 0 off · 1 smooth (IGN) · 2 grain */
  ditherMode: 0 | 1 | 2;
  dither: number;
  exposure: number;
  contrast: number;
  saturation: number;
}

export const LIQUID_PRESETS: Record<'waitlistkit' | 'gregale', LiquidParams> = {
  /** The template's own values, read from its uniforms. */
  waitlistkit: {
    colors: ['#f7fdd1', '#0099ff', '#0099ff', '#aeb6c2'],
    seed: 942,
    speed: 0.8,
    loop: 0,
    scale: 0.39,
    turbAmp: 0.65,
    turbFreq: 0.98,
    turbIter: 4,
    waveFreq: 1.6,
    distBias: 0,
    jellify: false,
    mousePush: 0.5,
    mouseRadius: 1,
    mouseStretch: 0,
    mousePersist: 0.8,
    ditherMode: 0,
    dither: 0.08,
    exposure: 1.1,
    contrast: 1.1,
    saturation: 1,
  },
  /** The site's field: the same shape in mint, the brand fill where the cyan was. */
  gregale: {
    colors: ['#f3fbf7', '#00ce91', '#00b7d6', '#b2bdb8'],
    seed: 942,
    speed: 0.8,
    loop: 0,
    scale: 0.39,
    turbAmp: 0.65,
    turbFreq: 0.98,
    turbIter: 4,
    waveFreq: 1.6,
    distBias: 0,
    jellify: false,
    mousePush: 0.5,
    mouseRadius: 1,
    mouseStretch: 0,
    mousePersist: 0.8,
    ditherMode: 0,
    dither: 0.08,
    exposure: 1.1,
    contrast: 1.1,
    saturation: 1,
  },
};

function hexToRgba(hex: string): [number, number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

const UNIFORM_NAMES = [
  'u_colors',
  'u_colors_length',
  'u_seed',
  'u_speed',
  'u_loop',
  'u_scale',
  'u_turbAmp',
  'u_turbFreq',
  'u_turbIter',
  'u_waveFreq',
  'u_distBias',
  'u_jellify',
  'u_mousePush',
  'u_mouseRadius',
  'u_mouseStretch',
  'u_mousePersist',
  'u_ditherMode',
  'u_dither',
  'u_exposure',
  'u_contrast',
  'u_saturation',
  'u_push_buffer',
  'u_time',
  'u_resolution',
  'u_deltaTime',
  'u_pixelRatio',
  'u_mousePosition',
  'u_mousePointerDown',
  'u_mouseHover',
] as const;
type Locs = Record<(typeof UNIFORM_NAMES)[number], WebGLUniformLocation | null>;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('[liquid-field] compile failed:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, frag: string): { prog: WebGLProgram; locs: Locs } | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('[liquid-field] link failed:', gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  const locs = Object.fromEntries(
    UNIFORM_NAMES.map((n) => [n, gl.getUniformLocation(prog, n)])
  ) as Locs;
  return { prog, locs };
}

interface Props {
  params: LiquidParams;
  /** Canvas pixels per CSS pixel. The template renders at 1. */
  pixelRatio?: number;
  /** Fade the bottom of the field into the page over this fraction of its height. */
  fadeBottom?: number;
  className?: string;
}

export function LiquidField({ params, pixelRatio = 1, fadeBottom = 0, className }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Coarse-pointer devices start on the static branded field. Deciding in the
  // initializer avoids constructing a WebGL context — and avoids a second
  // render — on phones and tablets.
  const [supported, setSupported] = useState(
    () =>
      typeof window === 'undefined' ||
      window.matchMedia('(hover: hover) and (pointer: fine)').matches
  );
  // Params flow through a ref so a slider move never rebuilds the GL state.
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  useEffect(() => {
    if (!supported) return;
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      powerPreference: 'default',
    });
    if (!gl) {
      setSupported(false);
      return;
    }
    const main = link(gl, FRAG_MAIN);
    const push = link(gl, FRAG_PUSH);
    if (!main || !push) {
      setSupported(false);
      return;
    }

    // One oversized triangle covers clip space.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    for (const { prog } of [main, push]) {
      const a = gl.getAttribLocation(prog, 'a_position');
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    }

    // Push buffer: two half-resolution RGBA16F textures, ping-ponged. Needs
    // EXT_color_buffer_float to render into; without it the field is zero
    // and the cursor simply has no effect.
    const floatOk = !!gl.getExtension('EXT_color_buffer_float');
    const tex: WebGLTexture[] = [];
    const fbo: WebGLFramebuffer[] = [];
    let pw = 1;
    let ph = 1;
    const makeTargets = () => {
      for (const t of tex) gl.deleteTexture(t);
      for (const f of fbo) gl.deleteFramebuffer(f);
      tex.length = 0;
      fbo.length = 0;
      pw = Math.max(1, Math.round(canvas.width / 2));
      ph = Math.max(1, Math.round(canvas.height / 2));
      for (let i = 0; i < 2; i++) {
        const t = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (floatOk) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, pw, ph, 0, gl.RGBA, gl.HALF_FLOAT, null);
        } else {
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            1,
            1,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            new Uint8Array(4)
          );
        }
        tex.push(t);
        const f = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        fbo.push(f);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };

    let read = 0;
    const mouse = { x: -999, y: -999, vx: 0, vy: 0, hover: 0, px: -999, py: -999 };
    let raf = 0;
    let running = false;
    let last = performance.now();
    let lastFrame = 0;
    let elapsed = 0;
    let onscreen = true;
    let visible = document.visibilityState === 'visible';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    const resize = () => {
      const w = Math.max(1, Math.round(host.clientWidth * pixelRatio));
      const h = Math.max(1, Math.round(host.clientHeight * pixelRatio));
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      makeTargets();
    };

    const setCommon = (locs: Locs, w: number, h: number, dt: number) => {
      const p = paramsRef.current;
      const colors = new Float32Array(8 * 4);
      p.colors.slice(0, 8).forEach((c, i) => colors.set(hexToRgba(c), i * 4));
      gl.uniform4fv(locs.u_colors, colors);
      gl.uniform1i(locs.u_colors_length, Math.min(8, p.colors.length));
      gl.uniform1f(locs.u_seed, p.seed);
      gl.uniform1f(locs.u_speed, p.speed);
      gl.uniform1f(locs.u_loop, p.loop);
      gl.uniform1f(locs.u_scale, p.scale);
      gl.uniform1f(locs.u_turbAmp, p.turbAmp);
      gl.uniform1f(locs.u_turbFreq, p.turbFreq);
      gl.uniform1f(locs.u_turbIter, p.turbIter);
      gl.uniform1f(locs.u_waveFreq, p.waveFreq);
      gl.uniform1f(locs.u_distBias, p.distBias);
      gl.uniform1f(locs.u_jellify, p.jellify ? 1 : 0);
      gl.uniform1f(locs.u_mousePush, p.mousePush);
      gl.uniform1f(locs.u_mouseRadius, p.mouseRadius);
      gl.uniform1f(locs.u_mouseStretch, p.mouseStretch);
      gl.uniform1f(locs.u_mousePersist, p.mousePersist);
      gl.uniform1f(locs.u_ditherMode, p.ditherMode);
      gl.uniform1f(locs.u_dither, p.dither);
      gl.uniform1f(locs.u_exposure, p.exposure);
      gl.uniform1f(locs.u_contrast, p.contrast);
      gl.uniform1f(locs.u_saturation, p.saturation);
      gl.uniform1f(locs.u_time, elapsed);
      gl.uniform2f(locs.u_resolution, w, h);
      gl.uniform1f(locs.u_deltaTime, dt);
      gl.uniform1f(locs.u_pixelRatio, pixelRatio);
      gl.uniform4f(locs.u_mousePosition, mouse.x, mouse.y, mouse.vx, mouse.vy);
      gl.uniform1f(locs.u_mousePointerDown, 0);
      gl.uniform1f(locs.u_mouseHover, mouse.hover);
      gl.uniform1i(locs.u_push_buffer, 0);
    };

    const draw = (dt: number) => {
      const write = 1 - read;
      // 1. push pass: read `read`, write `write`
      if (floatOk) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[write]);
        gl.viewport(0, 0, pw, ph);
        gl.useProgram(push.prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex[read]);
        setCommon(push.locs, pw, ph, dt);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      // 2. main pass to the screen, reading the fresh push field
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(main.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex[floatOk ? write : 0]);
      setCommon(main.locs, canvas.width, canvas.height, dt);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (floatOk) read = write;
      // velocity is per frame: consumed once
      mouse.vx = 0;
      mouse.vy = 0;
    };

    const tick = (now: number) => {
      if (!running) return;
      if (now - lastFrame >= 1000 / 30) {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        lastFrame = now;
        elapsed += dt;
        draw(dt);
      }
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
        draw(1 / 60);
        return;
      }
      if (onscreen && visible) {
        if (!running) {
          running = true;
          last = performance.now();
          lastFrame = 0;
          raf = requestAnimationFrame(tick);
        }
      } else stop();
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (!running) draw(1 / 60);
    });
    ro.observe(host);
    const io = new IntersectionObserver(([e]) => {
      onscreen = e.isIntersecting;
      sync();
    });
    io.observe(host);
    const onVis = () => {
      visible = document.visibilityState === 'visible';
      sync();
    };
    document.addEventListener('visibilitychange', onVis);
    reduced.addEventListener('change', sync);

    // Pointer in uv space (origin bottom-left, like v_uv); velocity per frame.
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = 1 - (e.clientY - r.top) / r.height;
      if (mouse.hover) {
        mouse.vx += x - mouse.px;
        mouse.vy += y - mouse.py;
      }
      mouse.x = x;
      mouse.y = y;
      mouse.px = x;
      mouse.py = y;
      mouse.hover = 1;
    };
    const onLeave = () => {
      mouse.hover = 0;
      mouse.vx = 0;
      mouse.vy = 0;
    };
    // The field sits behind the copy, so listen on the window and hit-test the host.
    const onWindowMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
        if (mouse.hover) onLeave();
        return;
      }
      onMove(e);
    };
    window.addEventListener('pointermove', onWindowMove, { passive: true });

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
      document.removeEventListener('visibilitychange', onVis);
      reduced.removeEventListener('change', sync);
      window.removeEventListener('pointermove', onWindowMove);
      canvas.removeEventListener('webglcontextlost', onLost);
      for (const t of tex) gl.deleteTexture(t);
      for (const f of fbo) gl.deleteFramebuffer(f);
      gl.deleteBuffer(buf);
      gl.deleteProgram(main.prog);
      gl.deleteProgram(push.prog);
    };
  }, [pixelRatio, supported]);

  const [c0, c1] = [params.colors[0] ?? '#fff', params.colors[1] ?? '#0099ff'];
  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      data-beam-field
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
      style={
        fadeBottom > 0
          ? {
              WebkitMaskImage: `linear-gradient(to bottom, black ${(1 - fadeBottom) * 100}%, transparent 100%)`,
              maskImage: `linear-gradient(to bottom, black ${(1 - fadeBottom) * 100}%, transparent 100%)`,
            }
          : undefined
      }
    >
      {supported ? (
        <canvas ref={canvasRef} className="block h-full w-full" />
      ) : (
        <div
          data-fallback
          className="absolute inset-0"
          style={{
            background: `linear-gradient(112deg, ${c0} 0%, ${c0} 38%, ${c1} 52%, ${c0} 66%, ${c0} 100%)`,
          }}
        />
      )}
    </div>
  );
}
