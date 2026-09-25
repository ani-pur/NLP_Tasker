// Ambient background for the glass theme: liquid blobs.
// A handful of large metaballs drift on slow Lissajous paths, merging and splitting
// as they pass each other. Each pixel sums the balls' influence, thresholds it with a
// soft edge plus a thin bright rim, and blends colors by influence, so edges stay
// defined without looking like blurry halos. Follows <html data-scheme="dark|light">.
// On load the blobs grow in one after another with an elastic overshoot.
// window.ambientPulse(color) fades the blobs to that task's color, holds, and fades
// back (called after a task is added).
//
// Rendering: a WebGL fragment shader when available, drawn on every animation frame,
// so it runs at the display's refresh rate (60/120/180/360Hz). Without WebGL it falls
// back to a CPU renderer at 1/4 resolution whose frame rate is picked by benchmark.
(function () {
  const canvas = document.getElementById('ambient');
  if (!canvas) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const PALETTES = {
    dark: {
      bg: [9, 9, 14], mix: 0.55, rim: [220, 224, 255], rimA: 0.6,
      colors: [[110, 118, 255], [168, 128, 255], [56, 189, 230], [236, 102, 170], [96, 150, 255], [140, 110, 245]],
    },
    light: {
      bg: [233, 235, 242], mix: 0.7, rim: [255, 255, 255], rimA: 0.9,
      colors: [[150, 158, 255], [200, 180, 255], [120, 214, 240], [250, 170, 210], [150, 196, 255], [180, 160, 250]],
    },
  };

  // cx, cy: path center (0..1); ax, ay: path extent; sx, sy: angular speed (rad/s);
  // r: radius as a fraction of the shorter screen side
  const BALLS = [
    { cx: 0.22, cy: 0.30, ax: 0.18, ay: 0.20, sx: 0.050, sy: 0.071, r: 0.20, c: 0 },
    { cx: 0.70, cy: 0.35, ax: 0.22, ay: 0.18, sx: 0.043, sy: 0.058, r: 0.24, c: 1 },
    { cx: 0.50, cy: 0.75, ax: 0.30, ay: 0.14, sx: 0.037, sy: 0.066, r: 0.19, c: 2 },
    { cx: 0.85, cy: 0.80, ax: 0.14, ay: 0.16, sx: 0.061, sy: 0.047, r: 0.15, c: 3 },
    { cx: 0.12, cy: 0.80, ax: 0.12, ay: 0.14, sx: 0.055, sy: 0.040, r: 0.16, c: 4 },
    { cx: 0.45, cy: 0.20, ax: 0.20, ay: 0.12, sx: 0.034, sy: 0.052, r: 0.13, c: 5 },
  ];
  const NB = BALLS.length;
  BALLS.forEach(b => { b.px = Math.random() * 6.28; b.py = Math.random() * 6.28; });

  // The field is defined in "field units" = CSS px * FIELD. The +1 softening term in
  // the falloff is in these units, so both renderers produce the same shapes.
  const FIELD = 0.25;

  let w = 0, h = 0, fw = 0, fh = 0;         // CSS size, field size
  let introStart = null;                    // set on the first frame
  let tint = null;                          // { rgb, start } while a task color is showing

  const TINT_IN = 0.7, TINT_HOLD = 1.3, TINT_OUT = 1.4;   // seconds
  const smooth = t => t * t * (3 - 2 * t);
  // ease-out with a small overshoot, so blobs "pop" into place instead of just scaling
  const easeOutBack = t => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

  function tintAmount(s) {
    if (!tint) return 0;
    const e = s - tint.start;
    if (e < TINT_IN) return smooth(e / TINT_IN);
    if (e < TINT_IN + TINT_HOLD) return 1;
    if (e < TINT_IN + TINT_HOLD + TINT_OUT) return smooth(1 - (e - TINT_IN - TINT_HOLD) / TINT_OUT);
    tint = null;
    return 0;
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }

  // Ball positions/radii/colors for time s, in field units, into flat arrays
  const PX = new Float32Array(NB), PY = new Float32Array(NB), PR = new Float32Array(NB);
  const COL = new Float32Array(NB * 3);
  function frameState(s) {
    const pal = PALETTES[document.documentElement.dataset.scheme === 'light' ? 'light' : 'dark'];
    const unit = Math.min(fw, fh);
    const ta = tintAmount(s);
    for (let i = 0; i < NB; i++) {
      const b = BALLS[i];
      // intro: each blob grows from nothing, staggered
      const p = introStart === null ? 1 : Math.min(1, Math.max(0, (s - introStart - i * 0.14) / 1.5));
      const scale = p >= 1 ? 1 : Math.max(0, easeOutBack(p));
      const base = pal.colors[b.c];
      for (let k = 0; k < 3; k++) {
        // task tint: pull each blob most of the way to the task color, keeping a hint of its own hue
        COL[i * 3 + k] = ta ? base[k] + (tint.rgb[k] - base[k]) * ta * 0.8 : base[k];
      }
      PX[i] = (b.cx + b.ax * Math.sin(s * 1.5 * b.sx + b.px)) * fw;
      PY[i] = (b.cy + b.ay * Math.sin(s * 1.5 * b.sy + b.py)) * fh;
      PR[i] = (b.r * unit * scale) ** 2;
    }
    return { pal, rimA: pal.rimA * (0.6 + 0.4 * ta) };
  }

  /* ───────────── GPU renderer ───────────── */
  function makeGL() {
    // probe on a throwaway canvas first: a canvas can only ever get one context type
    const probe = document.createElement('canvas').getContext('webgl', { failIfMajorPerformanceCaveat: true });
    if (!probe) return null;
    // software GL (no real GPU) is slower than the CPU path, so skip it
    const dbg = probe.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? String(probe.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    probe.getExtension('WEBGL_lose_context')?.loseContext();
    if (/swiftshader|llvmpipe|software|basic render/i.test(gpu)) return null;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) return null;
    const vs = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
    const fs = `
      precision highp float;
      uniform vec2 uSize;        // canvas size in device px
      uniform float uToField;    // device px -> field units
      uniform vec3 uBall[${NB}];  // x, y, r^2 (field units, y down)
      uniform vec3 uCol[${NB}];
      uniform vec3 uBg, uRim;
      uniform float uMix, uRimA;
      void main() {
        vec2 q = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y) * uToField;
        float f = 0.0; vec3 c = vec3(0.0);
        for (int k = 0; k < ${NB}; k++) {
          vec2 d = q - uBall[k].xy;
          float v = uBall[k].z / (dot(d, d) + 1.0);
          f += v; c += uCol[k] * v;
        }
        c /= max(f, 1e-6);
        // soft-edged inside mask around the threshold (f = 1), plus a gentle depth ramp inside
        float inside = smoothstep(0.85, 1.15, f);
        float depth = clamp((f - 1.0) * 0.35, 0.0, 1.0);
        float a = inside * uMix * (0.8 + 0.2 * depth);
        // thin bright rim right at the edge, like light on a liquid surface
        float rd = (f - 1.02) / 0.07;
        float rim = exp(-rd * rd) * uRimA;
        vec3 col = uBg + (c - uBg) * a + (uRim - uBg) * rim * 0.5;
        gl_FragColor = vec4(col / 255.0, 1.0);
      }`;
    function sh(type, src) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
      return s;
    }
    const v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);   // one big triangle
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    ['uSize', 'uToField', 'uBall', 'uCol', 'uBg', 'uRim', 'uMix', 'uRimA'].forEach(n => U[n] = gl.getUniformLocation(prog, n));
    const ball = new Float32Array(NB * 3);
    let scale = 1;

    return {
      resize() {
        // the blobs are soft, so ~0.75x device pixels looks the same and saves fill rate
        scale = Math.min(window.devicePixelRatio || 1, 2) * 0.75;
        canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
        gl.viewport(0, 0, canvas.width, canvas.height);
      },
      draw(s) {
        const { pal, rimA } = frameState(s);
        for (let i = 0; i < NB; i++) { ball[i * 3] = PX[i]; ball[i * 3 + 1] = PY[i]; ball[i * 3 + 2] = PR[i]; }
        gl.uniform2f(U.uSize, canvas.width, canvas.height);
        gl.uniform1f(U.uToField, FIELD / scale);
        gl.uniform3fv(U.uBall, ball);
        gl.uniform3fv(U.uCol, COL);
        gl.uniform3fv(U.uBg, pal.bg);
        gl.uniform3fv(U.uRim, pal.rim);
        gl.uniform1f(U.uMix, pal.mix);
        gl.uniform1f(U.uRimA, rimA);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
    };
  }

  /* ───────────── CPU fallback ───────────── */
  function make2D() {
    const ctx = canvas.getContext('2d');
    const off = document.createElement('canvas');
    const octx = off.getContext('2d');
    let img = null;
    return {
      resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = w * dpr; canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        off.width = fw; off.height = fh;
        img = octx.createImageData(fw, fh);
      },
      draw(s) {
        const { pal, rimA } = frameState(s);
        const [br, bg, bb] = pal.bg;
        const rimR = (pal.rim[0] - br) * 0.5, rimG = (pal.rim[1] - bg) * 0.5, rimB = (pal.rim[2] - bb) * 0.5;
        const mix = pal.mix;
        const data = img.data;
        let i = 0;
        for (let y = 0; y < fh; y++) {
          for (let x = 0; x < fw; x++, i += 4) {
            let f = 0, cr = 0, cg = 0, cb = 0;
            for (let k = 0; k < NB; k++) {
              const dx = x - PX[k], dy = y - PY[k];
              const v = PR[k] / (dx * dx + dy * dy + 1);
              f += v; cr += COL[k * 3] * v; cg += COL[k * 3 + 1] * v; cb += COL[k * 3 + 2] * v;
            }
            if (f <= 0.6) {                       // far from every blob: plain background
              data[i] = br; data[i + 1] = bg; data[i + 2] = bb; data[i + 3] = 255;
              continue;
            }
            cr /= f; cg /= f; cb /= f;
            let inside = 0;
            if (f >= 1.15) inside = 1;
            else if (f > 0.85) inside = smooth((f - 0.85) / 0.3);
            const depth = f > 1 ? Math.min(1, (f - 1) * 0.35) : 0;
            const a = inside * mix * (0.8 + 0.2 * depth);
            const rd = (f - 1.02) / 0.07;
            const rim = rd * rd < 16 ? Math.exp(-rd * rd) * rimA : 0;
            data[i]     = br + (cr - br) * a + rimR * rim;
            data[i + 1] = bg + (cg - bg) * a + rimG * rim;
            data[i + 2] = bb + (cb - bb) * a + rimB * rim;
            data[i + 3] = 255;
          }
        }
        octx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(off, 0, 0, w, h);
      },
    };
  }

  const glRenderer = makeGL();
  const renderer = glRenderer || make2D();
  canvas.style.width = '100%'; canvas.style.height = '100%';

  function resize() {
    w = window.innerWidth; h = window.innerHeight;
    fw = Math.max(1, Math.round(w * FIELD)); fh = Math.max(1, Math.round(h * FIELD));
    renderer.resize();
  }

  window.ambientPulse = function (color) {
    if (reduceMotion) return;
    const hex = /^#[0-9a-f]{6}$/i.test(color || '') && color.toUpperCase() !== '#FFFFFF'
      ? color
      : getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8b93ff';
    tint = { rgb: hexToRgb(hex), start: performance.now() / 1000 };
  };
  // redraw immediately when the light/dark toggle flips (matters for reduced motion)
  window.ambientRedraw = function () { renderer.draw(performance.now() / 1000); };

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resize(); renderer.draw(performance.now() / 1000); }, 150);
  });

  resize();
  if (reduceMotion) { renderer.draw(performance.now() / 1000); return; }

  // GPU: draw on every frame, i.e. at the display's refresh rate.
  // CPU: benchmark draw() and cap the rate so it uses at most ~30% of each frame.
  let frameMs = 0;
  window.ambientRenderer = glRenderer ? 'webgl' : 'cpu';   // for poking at in devtools
  if (!glRenderer) {
    const timed = s => { const t0 = performance.now(); renderer.draw(s); return performance.now() - t0; };
    for (let k = 0; k < 3; k++) renderer.draw(k);    // JIT warm-up
    const samples = [];
    for (let k = 0; k < 7; k++) samples.push(timed(10 + k));
    const cost = samples.sort((a, b) => a - b)[3];
    frameMs = 1000 / Math.max(24, Math.min(360, 0.3 * 1000 / cost));
  }

  // window.ambientFps: measured frame rate over the last second
  let last = 0, count = 0, windowStart = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    if (frameMs && t - last < frameMs * 0.85) return;
    last = t;
    if (introStart === null) { introStart = t / 1000; windowStart = t; }
    renderer.draw(t / 1000);
    count++;
    if (t - windowStart >= 1000) {
      window.ambientFps = Math.round(count * 1000 / (t - windowStart));
      count = 0; windowStart = t;
    }
  }
  requestAnimationFrame(frame);
})();
