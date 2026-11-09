// Phone version of ../hero3d.js, mounted into #hero-stage on landing_mobile.html.
// Same scene (particles gather into the logo, task cards orbit it), tuned for phones:
// - the stage is a squarish block above the hero copy, and the logo + ring are scaled to fit its width
// - fewer particles and a capped pixel ratio, so it holds its frame rate on mid-range phones
// - no mouse: touching the stage ripples the particles under your finger, tapping a card lifts it
// - the camera sways on its own instead of following a cursor
// - #hero-stage gets .live after the first frame, which fades out the static logo shown while loading
// Kept separate so the desktop scene is never touched by phone tweaks.
let THREE;
const host = document.getElementById('hero-stage');
if (host) boot().catch(() => host.classList.add('failed'));   // no WebGL / CDN down: the static logo stays

async function boot() {
  THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
  const { tier } = window.gpuTier || { tier: 1 };
  const N = [1600, 2200, 2800, 3200][tier];
  window.heroParticles = N;                                     // shown by the page's fps counter
  const PR = Math.min(devicePixelRatio, [1.5, 2, 2, 2][tier]);
  await Promise.all([
    document.fonts.load('500 150px "Instrument Sans"'), document.fonts.load('600 46px "Instrument Sans"'), document.fonts.load('500 28px "IBM Plex Mono"'),
  ]);

  /* ── the logo drawing the particles are sampled from ── */
  const DW = 520, DH = 300, SCALE = 11 / DW;                  // drawing px -> world units
  const LOGO_K = 0.72;                                          // logo drawn smaller than on desktop so bigger cards can circle it
  function drawLogo(g, dotColor = '#8b93ff') {
    g.font = '500 150px "Instrument Sans"'; g.textBaseline = 'middle'; g.letterSpacing = '-4px';
    const w = g.measureText('tasker').width, x0 = (DW - w - 48) / 2;
    g.fillStyle = '#ededf0'; g.fillText('tasker', x0, 150);
    g.fillStyle = dotColor; g.beginPath(); g.arc(x0 + w + 24, 188, 20, 0, Math.PI * 2); g.fill();
  }

  // particles: mostly on the letter outlines, with a light scatter inside for fill
  function sampleLogo() {
    const W = DW * 2, H = DH * 2;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.setTransform(2, 0, 0, 2, 0, 0); drawLogo(g);
    const d = g.getImageData(0, 0, W, H).data, on = i => d[i + 3] > 140;
    const edge = [], fill = [];
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
      const i = (y * W + x) * 4;
      if (!on(i)) continue;
      (!on(i - 12) || !on(i + 12) || !on(i - W * 12) || !on(i + W * 12) ? edge : fill).push(i);
    }
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) {
      const pool = k % 10 < 8 ? edge : fill;
      const i = pool[(Math.random() * pool.length) | 0], x = (i / 4) % W, y = Math.floor(i / 4 / W);
      pos[k * 3] = (x / 2 - DW / 2 + (Math.random() - 0.5) * 0.8) * SCALE * LOGO_K;
      pos[k * 3 + 1] = -(y / 2 - DH / 2 + (Math.random() - 0.5) * 0.8) * SCALE * LOGO_K;
      pos[k * 3 + 2] = (Math.random() - 0.5) * 0.25;
      col[k * 3] = d[i] / 255; col[k * 3 + 1] = d[i + 1] / 255; col[k * 3 + 2] = d[i + 2] / 255;
    }
    return { pos, col };
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(PR);
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  const stage = new THREE.Group(); scene.add(stage);

  /* ── particles ── */
  const { pos, col } = sampleLogo();
  const geo = new THREE.BufferGeometry();
  const size = new Float32Array(N), phase = new Float32Array(N), seed = new Float32Array(N), dir = new Float32Array(N * 3);
  for (let k = 0; k < N; k++) {
    size[k] = 0.8 + Math.random() ** 3 * 1.2; phase[k] = Math.random() * 6.283; seed[k] = Math.random();
    const v = new THREE.Vector3().randomDirection(); dir[k * 3] = v.x; dir[k * 3 + 1] = v.y; dir[k * 3 + 2] = v.z;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('dir', new THREE.BufferAttribute(dir, 3));
  const MAX_CARDS = 8;                                          // card light spill: positions/colors fed in each frame
  const uniforms = {
    uTime: { value: 0 }, uIntro: { value: 0 }, uAlpha: { value: 1 }, uPx: { value: PR * 17 }, uMouse: { value: new THREE.Vector2(99, 99) }, uHover: { value: 0 },
    uCardRect: { value: Array.from({ length: MAX_CARDS }, () => new THREE.Vector4(99, 99, 0, 0)) },
    uCardCol: { value: Array.from({ length: MAX_CARDS }, () => new THREE.Vector3()) },
    uCardA: { value: new Array(MAX_CARDS).fill(0) },
  };
  const points = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      attribute vec3 color, dir;
      attribute float size, phase, seed;
      uniform float uTime, uIntro, uPx, uHover;
      uniform vec2 uMouse;                                        // finger in logo space
      uniform vec4 uCardRect[${MAX_CARDS}];
      uniform vec3 uCardCol[${MAX_CARDS}];
      uniform float uCardA[${MAX_CARDS}];
      varying vec3 vColor; varying float vA; varying float vLit; varying float vTw;
      float sm(float x) { x = clamp(x, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }
      void main() {
        float ii = sm(uIntro * 1.5 - seed * 0.5);
        vec3 p = mix(dir * vec3(11.0, 7.0, 6.0) - vec3(0.0, 0.0, 3.0), position, ii);
        p += dir * 0.05 * sin(uTime * 0.9 + phase);
        vec2 off = p.xy - uMouse; float d = length(off);
        float near = (1.0 - smoothstep(0.0, 2.4, d)) * uHover;
        float wave = 0.5 + 0.5 * sin(d * 3.2 - uTime * 3.0 + seed * 1.5);
        p.xy += normalize(off + 1e-4) * near * (0.03 + 0.05 * wave);
        p.z += near * 0.12 * wave;
        vLit = near;
        float tw = pow(max(0.0, sin(uTime * (0.3 + seed * 0.45) + phase * 13.0)), 60.0);
        vTw = tw;
        vec3 tint = vec3(0.0); float wsum = 0.0;
        for (int k = 0; k < ${MAX_CARDS}; k++) {
          vec4 rc = uCardRect[k];
          vec2 dc = max(abs(p.xy - rc.xy) - rc.zw, 0.0);
          float w = uCardA[k] * exp(-dot(dc, dc) / 1.6);
          tint += uCardCol[k] * w; wsum += w;
        }
        tint /= max(wsum, 1e-4);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = size * (5.0 + near * 1.5 + tw * 4.0) * uPx / -mv.z;
        gl_Position = projectionMatrix * mv;
        vColor = mix(color, tint * 1.35, min(wsum, 1.0) * 0.75);
        vA = ii * (0.75 + 0.25 * sin(uTime * 1.6 + phase));
      }`,
    fragmentShader: `
      uniform float uAlpha;
      varying vec3 vColor; varying float vA; varying float vLit; varying float vTw;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float core = exp(-d * d * 260.0), halo = exp(-d * d * 18.0) * 0.34;
        vec3 c = mix(vColor, vec3(0.62, 0.66, 1.0), vLit * 0.8) * (1.0 + vLit * 0.6 + vTw * 1.15);
        gl_FragColor = vec4(c, (core + halo) * smoothstep(0.5, 0.35, d) * vA * uAlpha);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  points.frustumCulled = false;
  points.renderOrder = 0;
  stage.add(points);

  /* ── orbiting task cards ── */
  const HEX = { blue: '#87CEEB', red: '#f05656', green: '#6CE5A9', pink: '#F8C8DC', orange: '#ff7f00', purple: '#A96CE5', yellow: '#FDDA0D' };
  const TASKS = [
    ['Leg day at the gym', 'Mon · 7:00 AM', 'blue', '1h before'], ['Grocery run', 'Tue · 6:00 PM', 'yellow'],
    ['Submit lab report', 'Fri · 11:59 PM', 'purple', '5:00 PM'], ['Call mom', 'Tue · 12:00 PM', 'pink', '30m before'],
    ['Dentist', 'Tue · 9:00 AM', 'red'], ['Standup notes', 'Wed · 9:30 AM', 'green'], ['Oil change', 'Sat · 10:00 AM', 'orange'],
    ['Flight to Austin', 'Fri · 7:40 AM', 'yellow', '3:00 AM'],
  ];
  function bell(g, x, y, s) {
    g.beginPath();
    g.moveTo(x - s * 0.5, y + s * 0.3);
    g.quadraticCurveTo(x - s * 0.36, y + s * 0.12, x - s * 0.36, y - s * 0.08);
    g.arc(x, y - s * 0.08, s * 0.36, Math.PI, 0);
    g.quadraticCurveTo(x + s * 0.36, y + s * 0.12, x + s * 0.5, y + s * 0.3);
    g.closePath(); g.fill();
    g.beginPath(); g.arc(x, y + s * 0.4, s * 0.12, 0, Math.PI * 2); g.fill();
  }
  function cardTexture(name, when, color, rem) {
    const c = document.createElement('canvas'); c.width = 640; c.height = 200;
    const g = c.getContext('2d');
    g.beginPath(); g.roundRect(4, 4, 632, 192, 36);
    g.fillStyle = 'rgba(16,16,24,0.95)'; g.fill();
    const grad = g.createLinearGradient(0, 0, 640, 200);
    grad.addColorStop(0, color + '55'); grad.addColorStop(0.7, 'rgba(22,22,34,0)');
    g.fillStyle = grad; g.fill();
    g.lineWidth = 3; g.strokeStyle = color + '99'; g.stroke();
    g.fillStyle = color; g.beginPath(); g.roundRect(4, 40, 9, 120, [0, 8, 8, 0]); g.fill();
    g.font = '600 46px "Instrument Sans"'; g.fillStyle = color; g.fillText(name, 44, 86);
    g.font = '500 28px "IBM Plex Mono"';
    const w = g.measureText(when).width;
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.roundRect(44, 112, w + 32, 50, 12); g.fill();
    g.fillStyle = '#b6b6c2'; g.fillText(when, 60, 146);
    if (rem) {
      const x = 44 + w + 32 + 14, rw = g.measureText(rem).width + 74;
      g.beginPath(); g.roundRect(x, 112, rw, 50, 25);
      g.fillStyle = 'rgba(251,191,36,0.12)'; g.fill();
      g.lineWidth = 2; g.strokeStyle = 'rgba(251,191,36,0.35)'; g.stroke();
      g.fillStyle = '#fbbf24'; bell(g, x + 28, 136, 24); g.fillText(rem, x + 50, 146);
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    return tex;
  }
  // a phone is narrow, so on desktop proportions the cards end up too small to read: here they're
  // 1.35x bigger on a tighter ring, still clear of the (smaller) logo where they pass its ends
  const CW = 1.92 * 1.35, CH = 0.6 * 1.35;                       // card half-size
  const RING = { r: 6.0, depth: 0.42, lift: 2.3, roll: -0.08, speed: 0.075 };
  let ringA = 0;
  TASKS.slice(0, MAX_CARDS).forEach(([, , color], i) => uniforms.uCardCol.value[i].set(...new THREE.Color(HEX[color]).toArray()));
  const cards = TASKS.map(([name, when, color, rem], i) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CW * 2, CH * 2), new THREE.MeshBasicMaterial({ map: cardTexture(name, when, HEX[color], rem), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    stage.add(mesh);
    const front = new THREE.Mesh(mesh.geometry, mesh.material.clone());
    stage.add(front);
    return {
      mesh, front, a: (i / TASKS.length) * Math.PI * 2, dr: (Math.random() - 0.5) * 0.6, dy: (Math.random() - 0.5) * 0.6,
      phase: Math.random() * 10, fadeAt: 0.5 + i * 0.07, lift: 0, z: 0,
    };
  });

  /* ── sizing: logo centered, the whole ring (cards included) scaled to fit the stage's width ── */
  function layout() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const halfW = Math.tan(THREE.MathUtils.degToRad(20)) * 17 * camera.aspect;
    const halfH = Math.tan(THREE.MathUtils.degToRad(20)) * 17;
    const fitW = halfW * 0.9 / (RING.r + 0.3 + CW);               // widest point of the ring, card edge included, room for the sway
    const fitH = halfH * 0.9 / (RING.lift + 0.3 + CH + 0.6);      // top/bottom of the ring
    stage.userData.base = new THREE.Vector3(0, 0, 0);
    stage.scale.setScalar(Math.min(0.86, fitW, fitH));
    // points don't shrink with the stage, so scale their size with it or a small logo turns to mush
    uniforms.uPx.value = PR * 17 * Math.min(1, Math.max(0.55, stage.scale.x * LOGO_K / 0.86));
  }
  layout();
  new ResizeObserver(layout).observe(host);

  /* ── touch: a finger on the stage ripples the particles under it; a tap on a card lifts it ── */
  const ndc = new THREE.Vector2(), ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit = new THREE.Vector3();
  let touching = false, hover = 0, tapped = null, tappedUntil = 0, aimed = false;
  const mLocal = new THREE.Vector2(99, 99), mSmooth = new THREE.Vector2(99, 99);
  function aim(e) {
    const b = host.getBoundingClientRect();
    ndc.set((e.clientX - b.left) / b.width * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
    aimed = true;
  }
  host.addEventListener('pointerdown', e => {
    aim(e); touching = true;
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObjects(cards.filter(o => o.mesh.visible).map(o => o.mesh))[0];
    if (h) { tapped = h.object; tappedUntil = performance.now() + 2200; }
  });
  host.addEventListener('pointermove', e => { if (touching) aim(e); });
  // the page scrolling takes the touch over (pointercancel), so the ripple lets go there too
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) host.addEventListener(ev, () => { touching = false; });
  function trackFinger() {
    hover += ((touching ? 1 : 0) - hover) * 0.05;
    uniforms.uHover.value = hover;
    if (!aimed) return;
    ray.setFromCamera(ndc, camera);
    plane.constant = -stage.position.z;
    if (!ray.ray.intersectPlane(plane, hit)) return;
    stage.worldToLocal(hit);
    if (mSmooth.x === 99) mSmooth.set(hit.x, hit.y);
    mLocal.set(hit.x, hit.y);
    mSmooth.lerp(mLocal, 0.12);
    uniforms.uMouse.value.copy(mSmooth);
  }

  const smooth = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  const qz = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1);
  const cw = new THREE.Vector3();
  let start = null, prev = performance.now(), out = 0;
  renderer.setAnimationLoop(now => {
    // scrolled past the stage: lift and fade out, then stop drawing
    const top = host.getBoundingClientRect().top + scrollY;
    const target = Math.min(1, Math.max(0, (scrollY - top + host.clientHeight * 0.25) / (host.clientHeight * 0.85)));
    out += (target - out) * 0.12;
    if (out > 0.995) { prev = now; return; }
    if (start === null) { start = now; host.classList.add('live'); }
    const t = now / 1000, s = (now - start) / 1000, dt = Math.min(0.05, (now - prev) / 1000); prev = now;
    const fade = 1 - smooth(out);

    uniforms.uTime.value = t;
    uniforms.uIntro.value = Math.min(1, s / 1.8);
    uniforms.uAlpha.value = fade;

    // slow sway in place of a cursor-following camera
    camera.position.set(Math.sin(t * 0.21) * 0.9, 0.8 + Math.sin(t * 0.17 + 1) * 0.5, 17 + out * 5);
    const base = stage.userData.base;
    stage.position.set(base.x, base.y + out * 3.5, base.z);
    camera.lookAt(base.x, base.y, 0);
    stage.updateMatrixWorld(); trackFinger();

    const hovered = now < tappedUntil ? tapped : null;
    ringA += RING.speed * dt;
    const grow = 1 + out * 0.6, cr = Math.cos(RING.roll), sr = Math.sin(RING.roll);
    for (const o of cards) {
      const a = o.a + ringA;
      const rr = (RING.r + o.dr) * grow;
      const x0 = Math.cos(a) * rr, y0 = -Math.sin(a) * RING.lift * grow + o.dy + Math.sin(t * 0.4 + o.phase) * 0.1;
      const z = Math.sin(a) * rr * RING.depth;
      o.lift += ((o.mesh === hovered ? 1 : 0) - o.lift) * 0.12;
      o.mesh.position.set(x0 * cr - y0 * sr, x0 * sr + y0 * cr, z + o.lift * 0.6);
      o.mesh.scale.setScalar(1 + o.lift * 0.12);
      qz.setFromAxisAngle(zAxis, Math.sin(t * 0.3 + o.phase) * 0.06 * (1 - o.lift) + o.lift * 0.04);
      o.mesh.quaternion.copy(camera.quaternion).multiply(qz);
      o.mesh.material.opacity = smooth((s - o.fadeAt) / 0.7) * fade;
      o.mesh.visible = o.mesh.material.opacity > 0.005;
      o.z = z;
      const inFront = o.mesh === hovered ? 1 : smooth((z + 0.5) / 1.0);
      o.front.position.copy(o.mesh.position); o.front.quaternion.copy(o.mesh.quaternion); o.front.scale.copy(o.mesh.scale);
      o.front.material.opacity = o.mesh.material.opacity * inFront;
      o.front.visible = o.front.material.opacity > 0.005;
    }
    stage.updateMatrixWorld();
    cards.forEach((o, k) => {
      if (k >= MAX_CARDS) return;
      o.mesh.getWorldPosition(cw);
      ray.ray.origin.copy(camera.position); ray.ray.direction.copy(cw).sub(camera.position).normalize();
      plane.constant = -stage.position.z;
      if (!ray.ray.intersectPlane(plane, hit)) { uniforms.uCardA.value[k] = 0; return; }
      const ratio = camera.position.distanceTo(hit) / camera.position.distanceTo(cw);
      stage.worldToLocal(hit);
      uniforms.uCardRect.value[k].set(hit.x, hit.y, CW * o.mesh.scale.x * ratio, CH * o.mesh.scale.y * ratio);
      uniforms.uCardA.value[k] = o.mesh.material.opacity;
    });
    [...cards].sort((p, q) => p.z - q.z).forEach((o, k) => {
      o.mesh.renderOrder = -100 + k;
      o.front.renderOrder = o.mesh === hovered ? 1000 : 100 + k;
    });
    renderer.render(scene, camera);
  });
}
