import { useEffect, useRef } from 'react';

export type TracePoint = [x: number, y: number];
type Segment = [x1: number, y1: number, x2: number, y2: number];

type Selection = { points: TracePoint[]; index: number; color: string };

const vertex = `
  attribute vec2 position;
  void main() { gl_Position = vec4(position, 0., 1.); }
`;

const fragment = `
  precision highp float;
  uniform vec4 edges[8];
  uniform int count;
  uniform vec2 focusPoint;
  uniform vec3 ink;
  uniform vec3 highlight;

  float square(float value) { return value * value; }

  float distanceToEdge(vec2 pixel, vec4 edge) {
    vec2 run = edge.zw - edge.xy;
    float fraction = clamp(dot(pixel - edge.xy, run) / max(dot(run, run), .001), 0., 1.);
    return length(pixel - edge.xy - run * fraction);
  }

  void main() {
    vec2 pixel = gl_FragCoord.xy;
    vec2 offset = pixel - focusPoint;
    if (abs(offset.x) > 82. || abs(offset.y) > 105.) discard;
    float distance = 100.;
    for (int i = 0; i < 8; i++) {
      if (i < count) distance = min(distance, distanceToEdge(pixel, edges[i]));
    }
    if (distance > 12.) discard;
    float falloff = exp(-square(offset.x / 40.) - square(offset.y / 52.));
    float rim = exp(-square((distance - 3.) / 2.));
    float diffuse = exp(-square(distance / 7.));
    float sheen = .5 + .5 * sin(offset.y * .15 + offset.x * .12);
    vec3 light = mix(ink, highlight, rim * (.20 + .60 * sheen));
    gl_FragColor = vec4(light, falloff * (.30 * diffuse + .55 * rim));
  }
`;

function rgb(style: CSSStyleDeclaration, variable: string): [number, number, number] | null {
  const hex = style.getPropertyValue(variable).trim();
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function traceSegments({ points, index }: Selection): Segment[] {
  const segments: Segment[] = [];
  // TimeChart uses step-after geometry. A null sample breaks the line.
  for (let i = Math.max(0, index - 1); i < Math.min(points.length - 1, index + 2); i++) {
    const [[x1, y1], [x2, y2]] = [points[i], points[i + 1]];
    if (!Number.isFinite(y1) || !Number.isFinite(y2)) continue;
    segments.push([x1, y1, x2, y1], [x2, y1, x2, y2]);
  }
  const [x, y] = points[index];
  segments.push([x, y, x, y]);
  return segments;
}

function createRenderer(canvas: HTMLCanvasElement) {
  let gl: WebGLRenderingContext | null;
  try {
    gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
  } catch {
    return null;
  }
  if (!gl) return null;
  const context = gl;
  function compile(type: number, source: string) {
    const shader = context.createShader(type);
    if (!shader) return null;
    context.shaderSource(shader, source);
    context.compileShader(shader);
    if (context.getShaderParameter(shader, context.COMPILE_STATUS)) return shader;
    context.deleteShader(shader);
    return null;
  }
  const vs = compile(gl.VERTEX_SHADER, vertex);
  const fs = compile(gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  if (program && vs && fs) {
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
  }
  if (vs) gl.deleteShader(vs);
  if (fs) gl.deleteShader(fs);
  if (!program || !buffer || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
    return null;
  }

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const edges = gl.getUniformLocation(program, 'edges[0]');
  const count = gl.getUniformLocation(program, 'count');
  const focusPoint = gl.getUniformLocation(program, 'focusPoint');
  const ink = gl.getUniformLocation(program, 'ink');
  const highlight = gl.getUniformLocation(program, 'highlight');
  const pixels = new Float32Array(32);
  gl.clearColor(0, 0, 0, 0);
  return {
    draw(selection: Selection, segments: Segment[]) {
      const { clientWidth: width, clientHeight: height } = canvas;
      const style = getComputedStyle(canvas);
      const tint = rgb(style, selection.color);
      const brand = rgb(style, '--brand');
      if (!tint || !brand || !width || !height || gl.isContextLost()) return false;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      const x = (value: number) => (value / 100) * width;
      const y = (value: number) => (1 - value / 100) * height;
      segments.forEach(([a, b, c, d], i) => pixels.set([x(a), y(b), x(c), y(d)], i * 4));
      const [left, top] = selection.points[selection.index];
      gl.uniform4fv(edges, pixels);
      gl.uniform1i(count, segments.length);
      gl.uniform2f(focusPoint, x(left), y(top));
      gl.uniform3fv(ink, tint);
      gl.uniform3fv(highlight, brand);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return true;
    },
    dispose() {
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
    },
  };
}

/** Paints the selected SVG geometry. No animation loop and no WebGL requirement. */
export function TraceLight({ selection }: { selection?: Selection }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ReturnType<typeof createRenderer> | undefined>(undefined);
  const repaint = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const lost = (event: Event) => {
      event.preventDefault();
      canvas.style.visibility = 'hidden';
      renderer.current = null;
    };
    const restored = () => {
      renderer.current = undefined;
      repaint.current?.();
    };
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    return () => {
      renderer.current?.dispose();
      renderer.current = undefined;
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selection) return;
    const segments = traceSegments(selection);
    const draw = () => {
      if (renderer.current === undefined) renderer.current = createRenderer(canvas);
      const lit = renderer.current?.draw(selection, segments);
      canvas.style.visibility = lit ? 'visible' : 'hidden';
    };
    repaint.current = draw;
    draw();
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : undefined;
    resize?.observe(canvas);
    return () => {
      repaint.current = undefined;
      resize?.disconnect();
      canvas.style.visibility = 'hidden';
    };
  }, [selection]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-trace-light=""
      className="pointer-events-none invisible absolute inset-0 h-full w-full"
    />
  );
}
