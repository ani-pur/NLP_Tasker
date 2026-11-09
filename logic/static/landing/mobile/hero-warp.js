// Phone hero, the hidden one: warp. Your next few weeks fly at you: task cards (real dates, from
// dates.js) stream out of the logo through a tunnel of light. Each card spawns with its own random
// x/y/z tilt and drifts further as it nears the screen, the drift growing with the square of how
// far along it is, so it tumbles hardest right before it fades. Hold anywhere on it to go to warp.
import { stage, HEX, fontsReady } from './three-stage.js';
import { buildModel } from './dates.js';

function cardTexture(THREE, t, px = 1024) {
  const k = px / 640, c = document.createElement('canvas'); c.width = px; c.height = Math.round(200 * k);
  const g = c.getContext('2d'); g.scale(k, k);
  const hex = HEX[t.c];
  g.beginPath(); g.roundRect(4, 4, 632, 192, 34);
  g.fillStyle = 'rgba(14,14,22,0.94)'; g.fill();
  const grad = g.createLinearGradient(0, 0, 640, 200);
  grad.addColorStop(0, hex + '66'); grad.addColorStop(0.7, 'rgba(22,22,34,0)');
  g.fillStyle = grad; g.fill();
  g.lineWidth = 3; g.strokeStyle = (t.overdue ? '#ff6b6b' : hex) + 'aa'; g.stroke();
  g.fillStyle = hex; g.beginPath(); g.roundRect(4, 40, 9, 120, [0, 8, 8, 0]); g.fill();
  g.font = '600 50px "Instrument Sans", system-ui'; g.fillStyle = hex; g.fillText(t.n, 44, 88);
  g.font = '500 30px "IBM Plex Mono", monospace';
  const when = t.overdue ? `overdue · ${t.when}` : t.when;
  const w = g.measureText(when).width;
  g.fillStyle = t.overdue ? 'rgba(255,107,107,0.14)' : 'rgba(255,255,255,0.09)'; g.beginPath(); g.roundRect(44, 112, w + 32, 52, 12); g.fill();
  g.fillStyle = t.overdue ? '#ff8f8f' : '#c4c4d0'; g.fillText(when, 60, 148);
  if (t.r) {
    const x = 44 + w + 46, rw = g.measureText(t.r).width + 40;
    g.beginPath(); g.roundRect(x, 112, rw, 52, 26);
    g.fillStyle = 'rgba(251,191,36,0.14)'; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(251,191,36,0.4)'; g.stroke();
    g.fillStyle = '#fbbf24'; g.fillText(t.r, x + 20, 148);
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

export async function start(host) {
  await fontsReady();
  const s = stage(host, { fov: 60, dprCap: 3 });
  const { THREE, scene, camera, on } = s;
  const ui = document.createElement('div'); ui.className = 'hero-ui';
  ui.innerHTML = '<div class="warp-hint">hold to warp</div>';
  host.appendChild(ui);
  camera.position.set(0, 0, 0);

  const FAR = -42, NEAR = 1.2;
  const geo = new THREE.PlaneGeometry(2.2, 2.2 * 200 / 640);
  const rnd = () => (Math.random() - 0.5) * 2;
  let ang = 0;
  function place(o, z) {
    ang += 2.39996;                                               // golden angle: cards spread evenly round the tunnel
    o.th = ang; o.z = z;
    o.rx = 0.95 + Math.random() * 0.25; o.ry = 1.55 + Math.random() * 0.35;   // a tall tunnel, like the screen
    o.tilt = [rnd() * 0.5, rnd() * 0.55, rnd() * 0.32];             // its own random x/y/z rotation at spawn...
    o.spin = [rnd() * 1.1, rnd() * 1.25, rnd() * 0.8];              // ...and how far it drifts by the time it reaches you
  }
  let model = buildModel(new Date());
  const cards = model.tasks.map((t, i) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: cardTexture(THREE, t), transparent: true, depthWrite: false, opacity: 0 }));
    scene.add(m);
    const o = { m, t }; place(o, FAR + (i / model.tasks.length) * (NEAR - FAR)); return o;
  });
  // labels say "Today", "Tomorrow", "Mon"...: redraw them when the day (or an overdue flag) changes
  const refresh = setInterval(() => {
    const next = buildModel(new Date());
    next.tasks.forEach((t, i) => {
      const o = cards[i];
      if (o.t.when !== t.when || o.t.overdue !== t.overdue) { o.m.material.map.dispose(); o.m.material.map = cardTexture(THREE, t); }
      o.t = t;
    });
    model = next;
  }, 30000);

  const SN = 420, sp = new Float32Array(SN * 6), sc = new Float32Array(SN * 6), streak = [];
  const COLS = ['#8b93ff', '#a880ff', '#38bde6', '#ec66aa', '#ededf0'].map(c => new THREE.Color(c));
  for (let i = 0; i < SN; i++) {
    const a = Math.random() * Math.PI * 2, r = 1.4 + Math.random() * 5;
    streak.push({ x: Math.cos(a) * r * 0.75, y: Math.sin(a) * r, z: FAR + Math.random() * (NEAR - FAR), v: 0.7 + Math.random() * 0.6 });
    const c = COLS[i % COLS.length]; sc.set([c.r, c.g, c.b, c.r * 0.1, c.g * 0.1, c.b * 0.1], i * 6);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  scene.add(new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })));
  const core = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uW: { value: 0 } },
    vertexShader: 'varying vec2 u; void main(){ u = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform float uW; varying vec2 u; void main(){ float d = length(u - .5) * 2.; vec3 c = mix(vec3(.42,.45,1.), vec3(.8,.55,1.), uW); gl_FragColor = vec4(c * (exp(-d * d * 30.) * (.5 + uW * .6) + exp(-d * d * 4.) * .08), 1.); }',
  }));
  core.position.z = FAR - 2; scene.add(core);

  let holding = false, warp = 0;
  on(host, 'pointerdown', () => { holding = true; });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) on(host, ev, () => { holding = false; });

  s.loop((t, dt) => {
    warp += ((holding ? 1 : 0) - warp) * 0.05;
    host.classList.toggle('warping', warp > 0.3);
    core.material.uniforms.uW.value = warp;
    const speed = 3.2 + warp * 16;
    camera.rotation.z = Math.sin(t * 0.25) * 0.06;
    camera.fov = 60 + warp * 14; camera.updateProjectionMatrix();
    for (const o of cards) {
      o.z += speed * dt;
      if (o.z > NEAR) place(o, FAR);
      const tw = t * 0.15;
      o.m.position.set(Math.cos(o.th + tw) * o.rx, Math.sin(o.th + tw) * o.ry, o.z);
      const p = Math.min(1, Math.max(0, (o.z - FAR) / (NEAR - FAR))), p2 = p * p;   // drift ~ progress², strongest at the end
      o.m.rotation.set(-o.m.position.y * 0.08 + o.tilt[0] + o.spin[0] * p2, o.m.position.x * 0.12 + o.tilt[1] + o.spin[1] * p2, o.tilt[2] + o.spin[2] * p2);
      const fadeIn = Math.min(1, (o.z - FAR) / 10), fadeOut = Math.min(1, Math.max(0, (-o.z - 1.2) / 2.5));
      o.m.material.opacity = fadeIn * fadeOut;
    }
    const len = 0.25 + warp * 5;
    for (let i = 0; i < SN; i++) {
      const q = streak[i]; q.z += speed * q.v * 2.2 * dt;
      if (q.z > NEAR) q.z = FAR;
      sp.set([q.x, q.y, q.z, q.x, q.y, q.z - len * q.v], i * 6);
    }
    sg.attributes.position.needsUpdate = true;
  });

  return { stop() { clearInterval(refresh); s.stop(); ui.remove(); host.classList.remove('warping'); } };
}
