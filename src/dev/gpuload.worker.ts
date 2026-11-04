// SPDX-License-Identifier: GPL-3.0-or-later
// Dev-only GPU load in a worker (src/dev/perfrun.ts `gpuload`): WebGL2 on an OffscreenCanvas,
// drawing jobs of a chosen GPU length back to back, to see whether the main thread's frames
// (and the controls drawn on them) stay at display rate while a worker keeps the GPU busy.
// Each job is one draw whose per-pixel loop length is tuned until the job takes `ms`.

/**
 * `present`: 'none' draws into a texture only; 'placeholder' draws onto the canvas the page
 * transferred (WebKit shows it on the page's canvas); 'bitmap' draws on a canvas of its own and
 * posts each frame as an ImageBitmap for the page to show (transferFromImageBitmap).
 */
type Start = { type: 'start'; canvas: OffscreenCanvas; ms: number; size: number; present?: 'none' | 'placeholder' | 'bitmap'; w?: number; h?: number; chunks?: number };
type Stop = { type: 'stop' };

let running = false;
let jobs: number[] = [];

const VERT = `#version 300 es
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); gl_Position = vec4(p, 0., 1.); }`;
const FRAG = `#version 300 es
precision highp float;
uniform int n;
out vec4 o;
void main() {
  vec2 p = gl_FragCoord.xy * 1e-3;
  float a = p.x, b = p.y;
  for (int i = 0; i < n; i++) { a = fract(sin(a * 12.9898 + b) * 43758.5453); b = fract(a + b * 1.618); }
  o = vec4(a, b, 0., 1.);
}`;

function program(gl: WebGL2RenderingContext) {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s) ?? 'shader');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

async function load({ canvas, ms, size, present = 'none', w = 1552, h = 1036, chunks = 1 }: Start) {
  if (present !== 'none') { canvas.width = w; canvas.height = h; }
  const gl = canvas.getContext('webgl2')!;
  if (!gl) throw Error('no webgl2 in worker');
  const p = program(gl);
  gl.useProgram(p);
  const n = gl.getUniformLocation(p, 'n');
  // Draw into an offscreen target, like the engine's passes.
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, size, size);
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, size, size);
  if (present !== 'none') { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); }
  let iterations = 16;
  const frame = (f: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => f()) : setTimeout(f, 16));
  running = true; jobs = [];
  while (running) {
    const t0 = performance.now();
    // A job as `chunks` draws, each flushed on its own: does the GPU fit other work between them?
    gl.uniform1i(n, Math.max(1, Math.round(iterations / chunks)));
    for (let c = 0; c < chunks; c++) {
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (chunks > 1) gl.flush();
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
    gl.flush();
    while (gl.getSyncParameter(sync, gl.SYNC_STATUS) !== gl.SIGNALED) await new Promise(r => setTimeout(r, 1));
    gl.deleteSync(sync);
    const took = performance.now() - t0;
    if (present === 'bitmap') {
      const bmp = canvas.transferToImageBitmap();
      self.postMessage({ type: 'bitmap', bmp }, { transfer: [bmp] });
    }
    // Presented frames come at most once per display frame, like the develop loop's.
    if (present !== 'none') await new Promise<void>(r => frame(r));
    jobs.push(took);
    // Tune the loop towards the wanted job length (bounded steps, so one outlier can't swing it).
    iterations = Math.max(1, Math.round(iterations * Math.min(4, Math.max(0.25, ms / Math.max(0.5, took)))));
  }
}

self.onmessage = (e: MessageEvent<Start | Stop>) => {
  if (e.data.type === 'start') load(e.data).catch(err => self.postMessage({ type: 'error', error: String(err) }));
  else {
    running = false;
    // The settled jobs, after tuning: their median and worst.
    const settled = jobs.slice(Math.min(jobs.length - 1, 8)).sort((a, b) => a - b);
    self.postMessage({ type: 'stopped', jobs: jobs.length,
      jobMedianMs: settled.length ? +settled[Math.floor(settled.length / 2)].toFixed(1) : null,
      jobMaxMs: settled.length ? +settled[settled.length - 1].toFixed(1) : null });
  }
};
