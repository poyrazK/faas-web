import { GLSL_PRELUDE, useShaderCanvas } from './use-shader-canvas';

const FRAG = `${GLSL_PRELUDE}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float time = u_time * 0.27;

  // The lower-left light wraps around several soft folds. A slow shift of
  // the fold angle moves the reflection without moving the browser panels.
  vec2 light = uv - vec2(0.14, 0.04);
  float falloff = 1.0 - smoothstep(0.02, 0.96, length(light * vec2(1.0, 1.18)));
  float bend = sin(uv.y * 3.8 + time) * 0.48;
  float fold = uv.x * 6.0 - uv.y * 4.8 + bend;
  float reflection = 0.5 + 0.5 * sin(fold + sin(time) * 0.8);
  float fineFold = pow(0.5 + 0.5 * cos(fold * 4.2 - time * 0.6), 7.0);

  float heat = falloff * (0.3 + 0.52 * reflection + 0.18 * fineFold);
  vec3 copper = vec3(0.35, 0.16, 0.12);
  vec3 gold = vec3(0.98, 0.77, 0.52);
  vec3 color = mix(copper, gold, smoothstep(0.06, 0.81, heat));
  // Keep the grain still while the reflection moves, including at reduced motion.
  color += (bayer8(mod(gl_FragCoord.xy, 8.0)) - 0.5) * 0.035;

  float alpha = 0.18 + falloff * 0.43;
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

export function CopperField() {
  const { hostRef, canvasRef, supported } = useShaderCanvas({
    frag: FRAG,
    label: 'release-demo-copper',
    renderScale: 0.5,
  });

  return (
    <div ref={hostRef} aria-hidden="true" className="pointer-events-none absolute inset-0">
      {supported && <canvas ref={canvasRef} className="block size-full" />}
    </div>
  );
}
