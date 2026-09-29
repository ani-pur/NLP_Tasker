// Hero scene for the landing page, mounted into #hero-stage.
// Particles gather into the logo and stay as the logo; task cards (some carrying a custom
// reminder pill) fade in and orbit it. Scrolling past the hero lifts and fades the scene,
// and rendering stops once it's out of view.
// A classic script (not a module) so the page also works opened straight from disk; Three.js is
// pulled from the CDN with a dynamic import.
let THREE;
const host = document.getElementById('hero-stage');
if (host) boot();

async function boot() {
  THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
  const { tier } = window.gpuTier || { tier: 1 };
  const N = [3200, 4200, 5200, 6200][tier];
  const PR = Math.min(devicePixelRatio, [1, 1.5, 2, 2][tier]);
  await Promise.all([
    document.fonts.load('500 150px "Instrument Sans"'), document.fonts.load('600 46px "Instrument Sans"'), document.fonts.load('500 28px "IBM Plex Mono"'),
  ]);

  /* ── the logo drawing the particles are sampled from ── */
  const DW = 520, DH = 300, SCALE = 11 / DW;                  // drawing px -> world units
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
      pos[k * 3] = (x / 2 - DW / 2 + (Math.random() - 0.5) * 0.8) * SCALE;
      pos[k * 3 + 1] = -(y / 2 - DH / 2 + (Math.random() - 0.5) * 0.8) * SCALE;
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
  const uniforms = { uTime: { value: 0 }, uIntro: { value: 0 }, uAlpha: { value: 1 }, uPx: { value: PR * 17 }, uMouse: { value: new THREE.Vector2(99, 99) }, uHover: { value: 0 } };
  const points = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      attribute vec3 color, dir;
      attribute float size, phase, seed;
      uniform float uTime, uIntro, uPx, uHover;
      uniform vec2 uMouse;                                        // cursor in logo space
      varying vec3 vColor; varying float vA; varying float vLit;
      float sm(float x) { x = clamp(x, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }
      void main() {
        float ii = sm(uIntro * 1.5 - seed * 0.5);
        vec3 p = mix(dir * vec3(11.0, 7.0, 6.0) - vec3(0.0, 0.0, 3.0), position, ii);
        p += dir * 0.05 * sin(uTime * 0.9 + phase);             // slow breathing once formed
        // cursor: particles near it drift a little outward on a slow wave and light up, then settle back
        vec2 off = p.xy - uMouse; float d = length(off);
        float near = (1.0 - smoothstep(0.0, 2.4, d)) * uHover;
        float wave = 0.5 + 0.5 * sin(d * 3.2 - uTime * 3.0 + seed * 1.5);
        p.xy += normalize(off + 1e-4) * near * (0.03 + 0.05 * wave);
        p.z += near * 0.12 * wave;
        vLit = near;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = size * (5.0 + near * 1.5) * uPx / -mv.z;
        gl_Position = projectionMatrix * mv;
        vColor = color; vA = ii * (0.75 + 0.25 * sin(uTime * 1.6 + phase));
      }`,
    fragmentShader: `
      uniform float uAlpha;
      varying vec3 vColor; varying float vA; varying float vLit;
      void main() {
        // bright core plus a wide soft halo; overlapping halos along the outlines read as bloom
        float d = length(gl_PointCoord - 0.5);
        float core = exp(-d * d * 260.0), halo = exp(-d * d * 18.0) * 0.34;
        vec3 c = mix(vColor, vec3(0.62, 0.66, 1.0), vLit * 0.8) * (1.0 + vLit * 0.6);
        gl_FragColor = vec4(c, (core + halo) * smoothstep(0.5, 0.35, d) * vA * uAlpha);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  points.frustumCulled = false;
  points.renderOrder = 0;                                       // cards on the back half draw before it, the front half after
  stage.add(points);

  /* ── orbiting task cards ── */
  const HEX = { blue: '#87CEEB', red: '#f05656', green: '#6CE5A9', pink: '#F8C8DC', orange: '#ff7f00', purple: '#A96CE5', yellow: '#FDDA0D' };
  const TASKS = [
    ['Leg day at the gym', 'Mon · 7:00 AM', 'blue', '1h before'], ['Grocery run', 'Tue · 6:00 PM', 'yellow'],
    ['Submit lab report', 'Fri · 11:59 PM', 'purple', '5:00 PM'], ['Call mom', 'Tue · 12:00 PM', 'pink', '30m before'],
    ['Dentist', 'Tue · 9:00 AM', 'red'], ['Standup notes', 'Wed · 9:30 AM', 'green'], ['Oil change', 'Sat · 10:00 AM', 'orange'],
    ['Flight to Austin', 'Fri · 7:40 AM', 'yellow', '3:00 AM'],
  ];
  // small bell for the reminder pill (drawn, so it doesn't depend on an emoji font)
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
    if (rem) {                                                   // custom reminder, same amber pill as the app
      const x = 44 + w + 32 + 14, rw = g.measureText(rem).width + 74;
      g.beginPath(); g.roundRect(x, 112, rw, 50, 25);
      g.fillStyle = 'rgba(251,191,36,0.12)'; g.fill();
      g.lineWidth = 2; g.strokeStyle = 'rgba(251,191,36,0.35)'; g.stroke();
      g.fillStyle = '#fbbf24'; bell(g, x + 28, 136, 24); g.fillText(rem, x + 50, 146);
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    return tex;
  }
  const CW = 1.92, CH = 0.6;                                     // card half-size
  // all cards share one slowly turning ring, evenly spaced, so they never cross or overlap; each gets its
  // own jitter in radius, height and drift so it doesn't read as a rigid carousel. The ring is tilted:
  // the front passes below the logo and the back above it, which keeps the logo clear.
  const RING = { r: 7.3, depth: 0.42, lift: 2.7, roll: -0.08, speed: 0.06 };
  let ringA = 0;
  const cards = TASKS.map(([name, when, color, rem], i) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CW * 2, CH * 2), new THREE.MeshBasicMaterial({ map: cardTexture(name, when, HEX[color], rem), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    stage.add(mesh);
    return {
      mesh, a: (i / TASKS.length) * Math.PI * 2, dr: (Math.random() - 0.5) * 0.6, dy: (Math.random() - 0.5) * 0.6,
      phase: Math.random() * 10, fadeAt: 0.5 + i * 0.07, lift: 0, layer: 10 + i,
    };
  });

  /* ── sizing: the canvas fills the hero; the logo sits right of the copy on wide screens ── */
  function layout() {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const wide = camera.aspect > 1.25;
    // wide: logo in the right half, a little above center (the copy sits bottom-left)
    const halfW = Math.tan(THREE.MathUtils.degToRad(20)) * 17 * camera.aspect;
    stage.userData.base = new THREE.Vector3(wide ? halfW * 0.48 : 0, wide ? 0.8 : 2.4, 0);
    stage.scale.setScalar(wide ? 0.7 : 0.55);
  }
  layout();
  new ResizeObserver(layout).observe(host);

  const mouse = { x: 0, y: 0 }, cam = { x: 0, y: 0 };
  const ndc = new THREE.Vector2(), ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit = new THREE.Vector3();
  let over = false, hover = 0;
  const mLocal = new THREE.Vector2(99, 99), mSmooth = new THREE.Vector2(99, 99);
  addEventListener('pointermove', e => {
    mouse.x = e.clientX / innerWidth - 0.5; mouse.y = e.clientY / innerHeight - 0.5;
    const b = host.getBoundingClientRect();
    over = e.clientY >= b.top && e.clientY <= b.bottom;
    ndc.set((e.clientX - b.left) / b.width * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
  });
  document.addEventListener('pointerleave', () => { over = false; });
  function trackCursor() {
    ray.setFromCamera(ndc, camera);
    plane.constant = -stage.position.z;
    if (!ray.ray.intersectPlane(plane, hit)) return;
    stage.worldToLocal(hit);
    if (mSmooth.x === 99) mSmooth.set(hit.x, hit.y);
    mLocal.set(hit.x, hit.y);
    mSmooth.lerp(mLocal, 0.08);                                   // trail the cursor so the wave glides
    hover += ((over ? 1 : 0) - hover) * 0.05;
    uniforms.uMouse.value.copy(mSmooth); uniforms.uHover.value = hover;
  }

  const smooth = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  const qz = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1);
  let hovered = null;
  let start = null, prev = performance.now(), out = 0;
  renderer.setAnimationLoop(now => {
    // scrolled past the hero: lift and fade out, then stop drawing
    const target = Math.min(1, Math.max(0, scrollY / (host.clientHeight * 0.85)));
    out += (target - out) * 0.12;
    if (out > 0.995) { prev = now; return; }
    if (start === null) start = now;
    const t = now / 1000, s = (now - start) / 1000, dt = Math.min(0.05, (now - prev) / 1000); prev = now;
    const fade = 1 - smooth(out);

    uniforms.uTime.value = t;
    uniforms.uIntro.value = Math.min(1, s / 1.8);
    uniforms.uAlpha.value = fade;

    cam.x += (mouse.x * 3 - cam.x) * 0.035; cam.y += (-mouse.y * 1.8 - cam.y) * 0.035;
    camera.position.set(cam.x, 0.8 + cam.y, 17 + out * 5);
    const base = stage.userData.base;
    stage.position.set(base.x, base.y + out * 3.5, base.z);
    camera.lookAt(base.x * 0.5, base.y * 0.5, 0);
    stage.updateMatrixWorld(); trackCursor();

    // hover: sticky, so a card that moves as it pops forward doesn't flicker between hovered and not
    ray.setFromCamera(ndc, camera);
    const hits = over ? ray.intersectObjects(cards.filter(o => o.mesh.visible).map(o => o.mesh)).map(h => h.object) : [];
    if (!hits.includes(hovered)) hovered = hits[0] || null;
    host.style.cursor = hovered ? 'default' : '';
    ringA += RING.speed * dt;
    const grow = 1 + out * 0.6, cr = Math.cos(RING.roll), sr = Math.sin(RING.roll);
    for (const o of cards) {
      const a = o.a + ringA + Math.sin(t * 0.25 + o.phase) * 0.06;  // small drift, well inside the spacing
      const rr = (RING.r + o.dr) * grow;
      const x0 = Math.cos(a) * rr, y0 = -Math.sin(a) * RING.lift * grow + o.dy + Math.sin(t * 0.4 + o.phase) * 0.1;
      const z = Math.sin(a) * rr * RING.depth;
      o.lift += ((o.mesh === hovered ? 1 : 0) - o.lift) * 0.12;
      o.mesh.position.set(x0 * cr - y0 * sr, x0 * sr + y0 * cr, z + o.lift * 0.6);
      o.mesh.scale.setScalar(1 + o.lift * 0.08);
      qz.setFromAxisAngle(zAxis, Math.sin(t * 0.3 + o.phase) * 0.06 * (1 - o.lift) + o.lift * 0.04);
      o.mesh.quaternion.copy(camera.quaternion).multiply(qz);
      o.mesh.material.opacity = smooth((s - o.fadeAt) / 0.7) * fade;
      o.mesh.visible = o.mesh.material.opacity > 0.005;
      o.mesh.renderOrder = o.mesh === hovered ? 1000 : (z < 0 ? -100 : 100) + o.layer;  // behind or in front of the logo by which half of the ring it's on
    }
    renderer.render(scene, camera);
  });
}
