// Sky behind the landing page's hero, drawn procedurally in one fragment shader on its own canvas under the
// particle logo (#hero-stage's WebGL canvas is transparent, so the sky shows through).
//
// Looks (the "sky" pill): milky way (a band of gas cut by dark dust lanes) or nebula (big red-orange
// and blue gas clouds on the right). Stars are round dots with a soft glow, from hot blue-white to cool
// orange, in layers that drift at their own slow speeds so the sky roams with a little parallax.
//
// Levels (the level pill), gated by hardware at load:
//   plain    no sky (weak / software GPUs and phones start here)
//   good     the default on a real GPU: 45fps, up to 1.5x resolution
//   fry pc   opt-in only: 60fps at full resolution, extra cloud detail, a denser star layer, bigger
//            glows, more comets, and the layers shift with the mouse for depth
// Comets cross the sky now and then (one at a time on good, up to two on fry pc), on paths that steer
// clear of the logo: a tiny nucleus in a soft cyan-green coma, a broad striated dust tail that curves
// gently away, and a thin knotty blue ion tail. The gas slowly churns and the whole sky sways a little on
// its own, so it keeps living with no input. Scrolling away, the sky burns away (see the exit pass).
// A watchdog steps the level down if the page's frame rate drops after a level kicks in.
// Paused while the hero is off screen or the tab is hidden; one still frame for reduced motion.
// window.heroSkyMs: the sky's measured GPU time per frame (WebGL2 timer queries, where the browser
// allows them), shown by the hero's fps counter.
(function () {
  const canvas = document.getElementById('hero-stars');
  if (!canvas) return;
  const ui = document.querySelector('.sky-ui'), lookSeg = document.querySelector('[data-seg="look"]'), levelSeg = document.querySelector('[data-seg="level"]');
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' })
    || canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) { ui?.remove(); return; }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tier = (window.gpuTier || { tier: 1 }).tier;

  const LOOKS = { milkyway: { name: 'milky way', band: 1, neb: 0 }, nebula: { name: 'nebula', band: 0, neb: 1 } };
  const LEVELS = ['plain', 'good', 'fry'];
  const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  let look = LOOKS[store.get('tasker-sky')] ? store.get('tasker-sky') : 'milkyway';
  // hardware gate: a real GPU starts on good; weak / software GPUs and touch devices start plain.
  // fry pc is never a default, only an opt-in, and only offered on the strongest tier (or to someone
  // who already picked it)
  const savedLevel = store.get('tasker-sky-level') === 'batshit' ? 'fry' : store.get('tasker-sky-level');   // its old name
  let level = LEVELS.includes(savedLevel) ? savedLevel : tier >= 1 ? 'good' : 'plain';
  const canFry = tier >= 3 || level === 'fry';

  const vs = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }';
  const fs = `
    precision highp float;
    uniform vec2 uRes, uPar; uniform float uTime, uPx, uBand, uNeb, uLvl;
    uniform vec4 uCopy;                                                   // the hero copy's box (css px, gl y up): the sky clears behind it
    uniform vec4 uCa[3], uCb[3];                                          // comets: head x, y (css px), angle, alpha | tail length, spread, -, seed
    float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    vec2 h22(vec2 p){ float a = h21(p); return vec2(a, h21(p + a + 17.3)); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 6; i++) { s += a * noise(p); p = p * 2.03 + 11.7; a *= .5; } return s; }

    vec3 starCol(float h){                                                // mostly white; hot ones blue, cool ones orange
      return h < .45 ? mix(vec3(.6, .74, 1.), vec3(1.), h / .45) : h < .8 ? mix(vec3(1.), vec3(1., .82, .58), (h - .45) / .35) : mix(vec3(1., .66, .42), vec3(1., .52, .42), (h - .8) / .2);
    }

    // one star layer: a jittered grid, at most one star per cell (px = pixels per cell); round dots with
    // a bright core and a soft glow around it
    vec3 stars(vec2 q, float px, float dens, float sz, float tw, float glow){
      vec2 g = q / px, id0 = floor(g); vec3 acc = vec3(0.);
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 id = id0 + vec2(i, j); float r = h21(id);
        if (r > dens) continue;
        vec2 d = (g - id - .15 - h22(id + 3.1) * .7) * px;               // pixels from the star
        float k = h21(id + 9.7), b = pow(1. - r / dens, 2.2);               // brightness: most are faint
        float s = sz * (.5 + 1.1 * b), dd = dot(d, d);
        float t = 1. - tw * (.5 + .5 * sin(uTime * (.6 + 2.2 * k) + k * 60.));
        float core = exp(-dd / (s * s * .5));
        float halo = exp(-sqrt(dd) / (s * (1.6 + 1.6 * glow))) * (.12 + .22 * glow) * b;
        acc += starCol(k) * (core * (.35 + 1.15 * b) + halo) * t;
      }
      return acc;
    }

    // small distant galaxies: faint tilted smudges (no arms)
    vec3 galaxies(vec2 q, float px){
      vec2 g = q / px, id = floor(g); vec3 acc = vec3(0.);
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 c = id + vec2(i, j);
        if (h21(c + 41.) > .14) continue;
        vec2 d = (g - c - .2 - h22(c + 7.7) * .6) * px;
        float a = h21(c + 2.2) * 6.283, e = .3 + .5 * h21(c + 5.5), s = 1.6 + 3.5 * pow(h21(c + 8.8), 2.);
        d = mat2(cos(a), -sin(a), sin(a), cos(a)) * d; d.y /= e;
        float rr = dot(d, d);
        acc += (h21(c + 13.) < .55 ? vec3(1., .66, .38) : vec3(.6, .75, 1.)) * (exp(-rr / (s * s)) * .3 + exp(-rr / (s * s * .08)) * .5);
      }
      return acc;
    }

    // a comet: a tiny bright nucleus in a soft cyan-green coma; a broad, soft dust tail with fine
    // striations that curves gently away; and a thin, knotty blue ion tail that runs straight back
    vec3 comet(vec2 fc, vec4 a, vec4 b){
      vec2 dir = vec2(cos(a.z), sin(a.z)), rel = fc - a.xy;
      float along = dot(rel, -dir), side = dot(rel, vec2(-dir.y, dir.x));
      float L = b.x, tt = clamp(along / L, 0., 1.), behind = smoothstep(-3., 6., along);
      float sc = side - b.z * tt * tt * L * .14;                                              // the dust tail's curve
      float wd = 1.4 + tt * b.y;
      float stri = .72 + .28 * noise(vec2(sc * .3 + b.w * 40., along * .008));                 // striations along it
      float dust = behind * exp(-sc * sc / (wd * wd)) * pow(1. - tt, 1.35) * stri * .5;
      float inner = behind * exp(-sc * sc / (wd * wd * .07 + .5)) * pow(1. - tt, 4.) * .55;    // bright where it leaves the head
      vec2 n2 = vec2(-sin(a.z + .05), cos(a.z + .05));
      float s2 = dot(rel, n2), w2 = .55 + tt * 1.3;
      float knots = .55 + .45 * noise(vec2(along * .028 - uTime * 5., b.w * 9.));
      float ion = behind * exp(-s2 * s2 / (w2 * w2)) * pow(1. - min(1., along / (L * 1.25)), 1.6) * .42 * knots;
      float dd = dot(rel, rel);
      float nucleus = exp(-dd / 1.1) * 1.8, coma = exp(-sqrt(dd) / 8.) * .32 + exp(-dd / 60.) * .25;
      return (vec3(1., .9, .76) * (dust + inner) + vec3(.42, .66, 1.) * ion + vec3(1.) * nucleus + vec3(.62, 1., .9) * coma) * a.w;
    }

    void main(){
      vec2 fc = gl_FragCoord.xy / uPx, res = uRes / uPx;                 // CSS pixels
      float t = uTime, hi = step(1.5, uLvl);                               // hi: fry pc
      vec2 drift = vec2(t * 3.2, -t * 1.1);                               // px/s at the nearest layer
      vec2 u = (fc - drift * .25 - uPar * .25) / res.y;
      vec3 light = vec3(.02, .015, .05) * fbm(u * 2. + 99.);
      float dense = 0.;

      // the Milky Way: a band from lower left to upper right, warped by noise, cut by dark dust lanes
      if (uBand > 0.) {
        vec2 dir = normalize(vec2(1., .42)), nrm = vec2(-dir.y, dir.x);
        vec2 w = u * 2.2 + vec2(fbm(u * 1.6 + 3. + t * .012), fbm(u * 1.6 + 8. - t * .01)) * 1.1;   // slowly churns
        if (hi > 0.) w += vec2(fbm(w * 2.1 + 31.), fbm(w * 2.1 + 37.)) * .35;   // a second warp: finer filaments
        float across = dot(u - vec2(1.2, .72), nrm) + (fbm(u * 1.3 + 20.) - .5) * .35;
        float band = exp(-across * across / .05);
        float gas = fbm(w * 1.4), lanes = smoothstep(.42, .72, fbm(w * 2.6 + 30.)), wisp = fbm(w * 3.3 + 50.);
        vec3 neb = mix(vec3(.46, .14, .10), vec3(.95, .55, .27), smoothstep(.35, .78, gas));       // red-brown to warm orange
        neb = mix(neb, vec3(.10, .45, .62), smoothstep(.55, .85, fbm(w * 1.1 + 70.)) * .85);        // teal
        neb = mix(neb, vec3(.52, .20, .70), smoothstep(.6, .9, fbm(w * .9 + 90.)) * .7);             // violet
        neb += vec3(1., .85, .7) * smoothstep(.68, .95, gas) * .35 * band;                           // the bright core
        float g = band * (.25 + .75 * gas) * (1. - lanes * .85) * (.6 + .5 * wisp);
        light += neb * g * (.75 + .25 * hi) + vec3(.06, .07, .15) * band * .3 + neb * band * exp(-across * across / .2) * .05;
        dense = band;
      }

      // a nebula: big red-orange gas clouds with glowing filaments and a blue cloud, on the right
      if (uNeb > 0.) {
        vec2 w = u * 1.4 + vec2(fbm(u * 1.8 + 1. + t * .012), fbm(u * 1.8 + 6. - t * .01)) * 1.6;
        if (hi > 0.) w += vec2(fbm(w * 2.3 + 21.), fbm(w * 2.3 + 27.)) * .4;
        float n = fbm(w * 1.2), fil = pow(fbm(w * 3.1 + 4.), 3.) * 3.2;
        float side = smoothstep(.12, .72, fc.x / res.x) * (.6 + .4 * smoothstep(1., .15, fc.y / res.y));
        vec3 red = vec3(.95, .22, .09) * smoothstep(.38, .8, n) * (.55 + fil);
        vec3 hot = vec3(1., .62, .32) * smoothstep(.64, .95, fbm(w * 2.4 + 9.)) * .75;
        vec3 blue = vec3(.16, .5, 1.) * smoothstep(.55, .86, fbm(w * 1.05 + 40.)) * (.65 + fil * .5);
        vec3 haze = vec3(.5, .14, .2) * fbm(w * .6 + 15.) * .35;                                       // the faint glow the clouds sit in
        float dust = smoothstep(.5, .75, fbm(w * 2.8 + 60.));
        light += (red + hot + blue + haze) * (1. - dust * .55) * side * (.9 + .3 * hi);
        dense = side * smoothstep(.4, .8, n) * .7;
      }

      // behind the copy the sky opens up: the gas thins out and dims, so the text sits on dark starfield
      // (a soft rounded falloff around the copy's box, no visible edge)
      vec2 cq = max(abs(fc - (uCopy.xy + uCopy.zw * .5)) - uCopy.zw * .5, 0.);
      float clr = uCopy.z > 0. ? exp(-dot(cq, cq) / 22000.) : 0.;
      light *= 1. - clr * .88; dense *= 1. - clr;

      // stars: far dust (thick inside the gas), mid, near; nearer layers drift (and shift with the mouse) more
      float gl = .4 + .6 * hi;
      light += stars(fc - drift * .35 - uPar * .35, 5., .30 + .45 * dense, .55, 0., 0.) * (.35 + .5 * dense);
      if (hi > 0.) light += stars(fc - drift * .48 - uPar * .48, 9., .28 + .3 * dense, .65, .4, .3) * .6;
      light += stars(fc - drift * .6 - uPar * .6, 16., .32, .8, .55, gl * .6) * .85;
      light += stars(fc - drift - uPar, 70., .40, 1.3, .45, gl) * (1. - clr * .35);
      if (uBand > 0.) light += galaxies(fc - drift * .45 - uPar * .45, 150.) * .5;

      // comets
      for (int i = 0; i < 3; i++) if (uCa[i].w > 0.) light += comet(fc, uCa[i], uCb[i]);

      // soft rolloff so bright gas and glows stay vivid without clipping flat
      vec3 bg = vec3(.027, .027, .039), sky = bg + (1. - exp(-light * 1.15));

      gl_FragColor = vec4(sky, 1.);
    }`;

  // the exit pass (only while the hero scrolls away): the sky above is rendered into a texture, and this
  // burns it away. A ragged burn line climbs from the bottom as you scroll and keeps creeping and smoldering
  // when you stop: turbulent flame tongues lick up off it on a black-body heat ramp, the sky above shimmers
  // in the heat and chars dark with glowing spots, smoke curls up, and embers rise, drift and burn out.
  // Below the line the sky is gone.
  const fsLiquid = `
    precision highp float;
    uniform sampler2D uSky; uniform vec2 uRes; uniform float uPx, uTime, uScroll;
    float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.07 + 7.3; a *= .5; } return s; }
    vec3 sky(vec2 q){ return texture2D(uSky, clamp(q * uPx / uRes, vec2(.001), vec2(.999))).rgb; }
    vec3 heat(float t){                                                       // black body: deep red -> orange -> yellow -> white
      t = clamp(t, 0., 1.);
      return mix(mix(vec3(.35, .02, .0), vec3(1., .32, .03), smoothstep(0., .4, t)), mix(vec3(1., .72, .2), vec3(1., .97, .85), smoothstep(.75, 1., t)), smoothstep(.35, .8, t));
    }
    // the burn front: how far above it this point is, in px (negative: burned away)
    float front(vec2 fc, vec2 res, float t, float s){
      float n = (fbm(fc / 170. + vec2(0., t * .03)) - .5) * .42 + (fbm(fc / 45. + t * .05) - .5) * .07;
      return (fc.y / res.y + n - (s * 1.55 - .25)) * res.y;
    }
    void main(){
      vec2 fc = gl_FragCoord.xy / uPx, res = uRes / uPx;
      vec3 bg = vec3(.027, .027, .039);
      float t = uTime, s = uScroll, on = smoothstep(.0, .03, s);
      float e = front(fc, res, t, s);
      // heat haze: the sky just above the fire wobbles
      float hz = exp(-max(e, 0.) / 70.) * on;
      vec2 w = vec2(fbm(vec2(fc.x / 40., fc.y / 30. - t * 2.2)), fbm(vec2(fc.x / 40. + 9., fc.y / 30. - t * 2.2))) - .5;
      vec3 sk = sky(fc + w * 9. * hz);
      // char: darkened, browned sky above the edge, with spots that still glow
      float ch = 1. - smoothstep(0., 55., e);
      sk = mix(sk, sk * vec3(.22, .16, .13), ch * on);
      float spots = smoothstep(.62, .8, fbm(fc / 14. + t * .15)) * ch * (1. - smoothstep(0., 30., e));
      sk += heat(.45 + .3 * noise(fc / 6. + t)) * spots * .9 * on;
      // smoke: dark wisps curling up off the fire
      float sm = fbm(vec2(fc.x / 90. + sin(fc.y / 120. + t * .3) * .4, fc.y / 70. - t * .35));
      sk *= 1. - smoothstep(.45, .8, sm) * exp(-max(e, 0.) / 160.) * step(0., e) * .55 * on;
      vec3 col = e < 0. ? bg : sk;
      // flames: tongues that lick up from the edge, flickering
      float fl = fbm(vec2(fc.x / 26., fc.y / 34. - t * 3.2)) * .65 + fbm(vec2(fc.x / 9., fc.y / 12. - t * 5.)) * .35;
      float fh = 12. + 46. * fl * fl;                                         // how tall the flame is here
      float flame = (e >= -3.) ? clamp(1. - e / fh, 0., 1.) : 0.;
      flame = pow(flame, 1.6) * smoothstep(.25, .55, fl + .25 - max(e, 0.) / 180.);
      float edge = exp(-abs(e) / 2.2);                                       // the white-hot line itself
      col += heat(flame * .95 + edge * .5) * (flame * 1.5 + edge * 1.3) * on;
      col += vec3(1., .35, .06) * exp(-abs(e) / 40.) * .16 * on;             // its glow on the surroundings
      // embers: rise from the edge, drift sideways, streak a little, flicker and burn out
      for (int k = 0; k < 2; k++) {
        float sz = k == 0 ? 26. : 15., sp = k == 0 ? 55. : 80.;
        vec2 g = vec2(fc.x / sz, (fc.y - t * sp) / sz); vec2 id = floor(g), f = fract(g) - .5;
        float r = h21(id + float(k) * 31.);
        if (r < .9) continue;
        f.x += sin(t * 2. + r * 40.) * .25;
        float age = fract(r * 13.);                                           // how far up it has risen
        float ee = front(vec2((id.x + .5) * sz, fc.y - age * 220.), res, t, s); // the edge it rose from
        float near = exp(-abs(ee) / 25.) * (1. - age);
        float flick = .6 + .4 * sin(t * 18. + r * 90.);
        float d = f.x * f.x * 90. + f.y * f.y * 24.;                          // streaked upward
        col += heat(.6 + .4 * flick) * exp(-d) * near * flick * 1.8 * on;
      }
      gl_FragColor = vec4(col, 1.);
    }`;

  function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
  function link(f) {
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, f));
    gl.bindAttribLocation(pr, 0, 'p'); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.warn('hero sky:', gl.getProgramInfoLog(pr)); return null; }
    return pr;
  }
  const prog = link(fs), liquid = link(fsLiquid);
  if (!prog) { ui?.remove(); return; }
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const U = n => gl.getUniformLocation(prog, n);
  const uRes = U('uRes'), uPar = U('uPar'), uTime = U('uTime'), uPx = U('uPx'), uBand = U('uBand'), uNeb = U('uNeb'), uLvl = U('uLvl'), uCa = U('uCa'), uCb = U('uCb');

  // GPU timing (WebGL2 + EXT_disjoint_timer_query_webgl2): time one frame in every few, smooth it
  const tq = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
  let query = null, qFrame = 0, gpuMs = 0;
  function timed(fn) {
    if (!tq) return fn();
    if (query && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
      if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) { const ms = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6; gpuMs = gpuMs ? gpuMs * 0.8 + ms * 0.2 : ms; window.heroSkyMs = gpuMs; }
      gl.deleteQuery(query); query = null;
    }
    if (!query && ++qFrame % 4 === 0) { query = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, query); fn(); gl.endQuery(tq.TIME_ELAPSED_EXT); }
    else fn();
  }

  const L2 = n => liquid && gl.getUniformLocation(liquid, n);
  const lq = { sky: L2('uSky'), res: L2('uRes'), px: L2('uPx'), time: L2('uTime'), scroll: L2('uScroll') };
  // the texture the sky renders into while the liquid pass is on
  const skyTex = gl.createTexture(), fbo = gl.createFramebuffer();
  gl.bindTexture(gl.TEXTURE_2D, skyTex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, skyTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  let px = 1;
  function size() {
    const r = canvas.getBoundingClientRect();
    px = Math.min(devicePixelRatio || 1, level === 'fry' ? 2 : tier >= 2 ? 1.5 : 1);
    canvas.width = Math.max(1, Math.round(r.width * px)); canvas.height = Math.max(1, Math.round(r.height * px));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.bindTexture(gl.TEXTURE_2D, skyTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  // motion with no input: the sky sways gently on its own; on fry pc the mouse adds to it
  const mouse = { x: 0, y: 0 }, par = { x: 0, y: 0 };
  const hero = canvas.closest('.hero') || canvas.parentElement, copyEl = hero.querySelector('.hero-copy');
  hero.addEventListener('pointermove', e => { const r = hero.getBoundingClientRect(); mouse.x = (e.clientX - r.left) / r.width - 0.5; mouse.y = (e.clientY - r.top) / r.height - 0.5; });
  hero.addEventListener('pointerleave', () => { mouse.x = mouse.y = 0; });

  // comets: each crosses the whole hero, many corner to corner; long-lived (6-11s), long tails
  const comets = [], ca = new Float32Array(12), cb = new Float32Array(12);
  let nextComet = 0;
  // the particle logo sits right of center (hero3d.js): comet paths must pass well clear of it
  function clearsLogo(sx, sy, tx, ty, w, h) {
    const lx = w * 0.6, ly = h * 0.53, rx = w * 0.25, ry = h * 0.15;     // gl coords: y up
    const ax = (sx - lx) / rx, ay = (sy - ly) / ry, bx = (tx - lx) / rx, by = (ty - ly) / ry;
    const dx = bx - ax, dy = by - ay, k = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)));
    return Math.hypot(ax + dx * k, ay + dy * k) > 1.3;
  }
  function spawnComet(now) {
    const w = canvas.width / px, h = canvas.height / px, m = 160;
    let sx, sy, tx, ty, tries = 0;
    do {
      if (Math.random() < 0.5) {                                        // corner to corner
        const fromLeft = Math.random() < 0.5;
        sx = fromLeft ? -m : w + m; sy = h + m * (0.3 + Math.random()) - h * Math.random() * 0.25;
        tx = fromLeft ? w + m : -m; ty = -m * (0.3 + Math.random()) + h * Math.random() * 0.3;
      } else {                                                          // from the top edge, down across
        sx = w * (-0.1 + Math.random() * 1.2); sy = h + m;
        const dirX = sx < w / 2 ? 1 : -1;
        tx = sx + dirX * h * (0.9 + Math.random() * 0.8); ty = -m;
      }
    } while (!clearsLogo(sx, sy, tx, ty, w, h) && ++tries < 40);
    if (tries >= 40) return;
    const dx = tx - sx, dy = ty - sy;
    comets.push({ sx, sy, a: Math.atan2(dy, dx), dist: Math.hypot(dx, dy), t: now, d: 9000 + Math.random() * 6000,
      len: 300 + Math.random() * 320, spread: 14 + Math.random() * 18, curve: (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.6),
      b: 0.8 + Math.random() * 0.3, seed: Math.random() });
  }
  function updateComets(now) {
    const max = level === 'fry' ? 2 : 1;
    for (let i = comets.length - 1; i >= 0; i--) if (now - comets[i].t > comets[i].d) comets.splice(i, 1);
    if (!nextComet) nextComet = now + (level === 'fry' ? 1500 : 5000);
    if (now > nextComet && comets.length < max) {
      spawnComet(now);
      nextComet = now + (level === 'fry' ? 5000 + Math.random() * 7000 : 15000 + Math.random() * 15000);
    }
    ca.fill(0); cb.fill(0);
    comets.slice(0, 2).forEach((c, i) => {
      const p = (now - c.t) / c.d, fade = Math.min(1, p / 0.06, (1 - p) / 0.12);
      ca.set([c.sx + Math.cos(c.a) * c.dist * p, c.sy + Math.sin(c.a) * c.dist * p, c.a, Math.max(0, fade) * c.b], i * 4);
      cb.set([c.len, c.spread, c.curve, c.seed], i * 4);
    });
  }

  const t0 = performance.now() - 40000;                                 // start mid-drift, not at the origin
  let lastDraw = 0;
  function draw(now) {
    if (level === 'plain') return;
    const L = LOOKS[look], hi = level === 'fry', dt = lastDraw ? Math.min(0.1, (now - lastDraw) / 1000) : 0; lastDraw = now;
    const ts = (now - t0) / 1000, sx = Math.sin(ts * 0.05) * 22 + Math.sin(ts * 0.013) * 14, sy = Math.cos(ts * 0.037) * 12;
    const mx = hi ? mouse.x * 46 : 0, my = hi ? -mouse.y * 30 : 0;
    par.x += (sx + mx - par.x) * Math.min(1, dt * 2.5); par.y += (sy + my - par.y) * Math.min(1, dt * 2.5);
    updateComets(now);
    gl.useProgram(prog);                                              // (the liquid pass may have left its program bound)
    gl.uniform2f(uRes, canvas.width, canvas.height); gl.uniform1f(uPx, px); gl.uniform2f(uPar, par.x, par.y);
    gl.uniform1f(uTime, (now - t0) / 1000); gl.uniform1f(uLvl, LEVELS.indexOf(level));
    gl.uniform1f(uBand, L.band); gl.uniform1f(uNeb, L.neb);
    gl.uniform4fv(uCa, ca); gl.uniform4fv(uCb, cb);
    const cr = copyEl?.getBoundingClientRect(), kr = canvas.getBoundingClientRect();
    if (cr) gl.uniform4f(U('uCopy'), cr.left - kr.left - 30, kr.bottom - cr.bottom - 30, cr.width + 60, cr.height + 60);
    const hr = hero.getBoundingClientRect(), sc = Math.max(0, Math.min(1, -hr.top / (hr.height * 0.75)));
    const wet = sc > 0.001 && liquid;
    // stats for the hero's counter: rough star count (by layer density), comets, render size, passes
    const area = (canvas.width / px) * (canvas.height / px);
    window.heroSkyStats = {
      stars: Math.round(area / 25 * 0.4 + area / 256 * 0.32 + area / 4900 * 0.4 + (hi ? area / 81 * 0.35 : 0)),
      comets: comets.length, w: canvas.width, h: canvas.height, passes: wet ? 2 : 1, level,
    };
    gl.bindFramebuffer(gl.FRAMEBUFFER, wet ? fbo : null);
    timed(() => {
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!wet) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(liquid);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, skyTex);
      gl.uniform1i(lq.sky, 0); gl.uniform2f(lq.res, canvas.width, canvas.height); gl.uniform1f(lq.px, px);
      gl.uniform1f(lq.time, (now - t0) / 1000); gl.uniform1f(lq.scroll, sc);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
  }

  // the controls: two sliding pills (sky: milky way | nebula; quality: plain | good | fry pc).
  // A change fades the sky out, swaps, and fades it back in.
  if (!canFry) levelSeg?.querySelector('[data-v="fry"]')?.remove();
  function slide(seg, v) {
    if (!seg) return;
    const btns = [...seg.querySelectorAll('button')], on = btns.find(b => b.dataset.v === v) || btns[0], th = seg.querySelector('.thumb');
    btns.forEach(b => b.setAttribute('aria-pressed', String(b === on)));
    th.style.left = on.offsetLeft + 'px'; th.style.width = on.offsetWidth + 'px';
    seg.dataset.v = v;
  }
  function label() {
    slide(lookSeg, look); slide(levelSeg, level);
    lookSeg?.classList.toggle('dim', level === 'plain');
    canvas.classList.toggle('off', level === 'plain');
    hero.classList.toggle('sky-on', level !== 'plain');           // the copy gets its black strips
    if (level === 'plain') { window.heroSkyMs = 0; window.heroSkyStats = null; }
  }
  function change(fn) {
    fn(); label();                                                  // the thumb moves right away
    canvas.classList.add('off');
    setTimeout(() => { gpuMs = 0; window.heroSkyMs = 0; size(); label(); lastDraw = 0; draw(performance.now()); sync(); watch(); }, 260);
  }
  lookSeg?.addEventListener('click', e => { const v = e.target.closest('button')?.dataset.v; if (v && v !== look && level !== 'plain') change(() => { look = v; store.set('tasker-sky', look); }); });
  levelSeg?.addEventListener('click', e => { const v = e.target.closest('button')?.dataset.v; if (v && v !== level) change(() => { level = v; store.set('tasker-sky-level', level); }); });
  document.fonts?.ready.then(label);                                // the pill widths settle once the font loads

  // watchdog: after a level kicks in, watch the page's frame rate for a few seconds; if it can't hold
  // ~40fps, step down a level (and remember it)
  let watching = 0;
  function watch() {
    if (reduce || level === 'plain' || window.__noWatch) return;      // __noWatch: for screenshot tests on software GL
    const id = ++watching, start = performance.now() + 1200; let frames = 0;
    requestAnimationFrame(function tick(now) {
      if (id !== watching) return;
      if (document.hidden || !visible) { watching++; return; }
      if (now >= start) frames++;
      if (now < start + 3000) return requestAnimationFrame(tick);
      if (frames / 3 < 40) change(() => { level = LEVELS[LEVELS.indexOf(level) - 1]; store.set('tasker-sky-level', level); });
    });
  }

  let visible = true, raf = 0, last = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (level !== 'fry' && now - last < 1000 / 45 - 2) return;            // good: capped at 45fps
    last = now; draw(now);
  }
  function sync() {
    const run = !reduce && visible && !document.hidden && level !== 'plain';
    if (run && !raf) raf = requestAnimationFrame(frame);
    else if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  addEventListener('scroll', () => { if (reduce) draw(performance.now()); }, { passive: true });   // the dissolve follows the scroll even with motion off
  label(); size();
  new ResizeObserver(() => { size(); draw(performance.now()); }).observe(canvas);
  draw(performance.now());
  new IntersectionObserver(e => { visible = e[0].isIntersecting; sync(); }).observe(canvas);
  document.addEventListener('visibilitychange', sync);
  sync(); watch();
})();
