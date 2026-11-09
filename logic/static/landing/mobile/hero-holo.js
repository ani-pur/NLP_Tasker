// Phone hero, default: the holo calendar. A 3D month of glass blocks running on the real today
// (dates.js: a rolling 5 weeks, today in row 2). Every few seconds the next day with tasks lifts, bobs,
// lights up and shows its tasks. Look-only: no taps or drags.
// The model is rebuilt every 30s, so overdue flags flip on time and a page left open past midnight
// moves "today" along.
import { stage, HEX, glowMaterial, fontsReady } from './three-stage.js';
import { buildModel, fmtDay, fmtTime, fmtMonthDay, dayKey } from './dates.js';

const SHOW_FOR = 4.2;                                            // seconds each popup stays up
const LIFT = 0.3;                                                // how high the active day rises (before its bob)
const GAP = 20;                                                  // px between a day and its popup's arrow
const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function start(host) {
  await fontsReady();
  const s = stage(host, { fov: 46, dprCap: 3 });                // a light scene: render at the phone's full resolution
  const { THREE, scene, camera, on } = s;
  const ui = document.createElement('div'); ui.className = 'hero-ui';
  ui.innerHTML = '<div class="pop below"></div>';               // under its day, arrow pointing up
  host.appendChild(ui);
  const logoEl = host.parentElement.querySelector('.hero-logo'), popEl = ui.querySelector('.pop');

  const S = 1, GAP_TILES = 0.16, H = 0.26, COLS = 7, ROWS = 5;
  const grid = new THREE.Group(); scene.add(grid);
  const ox = -((COLS - 1) * (S + GAP_TILES)) / 2, oz = -((ROWS - 1) * (S + GAP_TILES)) / 2;
  // one soft pool of light under the whole month, so it sits on something
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), glowMaterial(0x8b93ff, 0.16, 2.2));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -H / 2 - 0.05; grid.add(floor);

  // the top face: only the number and task bars are solid, the rest is clear so the glass shows through.
  // Raw (non-sRGB) texture: the block shader works in the same space as these colors.
  function face(c) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const g = cv.getContext('2d'); g.scale(2, 2);                  // drawn at 2x: crisp at 3x-DPR sizes
    const num = c.monthStart ? fmtMonthDay(c.date) : String(c.date.getDate());
    g.font = `600 ${c.monthStart ? 46 : 58}px "Instrument Sans", system-ui`;
    if (c.today) {                                                // accent badge, like the desktop calendar
      const w = g.measureText(num).width;
      g.fillStyle = '#8b93ff'; g.beginPath(); g.roundRect(22, 26, w + 28, 70, 16); g.fill();
      g.fillStyle = '#0b0b14'; g.fillText(num, 36, 82);
    } else {
      g.fillStyle = c.monthStart ? '#8b93ff' : c.past ? 'rgba(200,200,215,0.42)' : 'rgba(225,225,236,0.92)';
      g.fillText(num, 28, 82);
    }
    c.tasks.slice(0, 2).forEach((t, k) => {
      g.globalAlpha = c.past ? 0.55 : 1; g.fillStyle = HEX[t.c];
      g.beginPath(); g.roundRect(28, 160 + k * 38, 200, 20, 10); g.fill();
    });
    g.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(cv); tex.anisotropy = s.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }
  function label(text) {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
    const g = cv.getContext('2d'); g.font = '500 40px "IBM Plex Mono", monospace'; g.fillStyle = 'rgba(169,169,182,0.75)'; g.textAlign = 'center'; g.fillText(text, 64, 46);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // Glass blocks with neon edges, all in one shader: the edges are drawn from each face's UVs (distance to
  // the nearest edge), thick, antialiased per pixel (fwidth) with a soft blurred halo, so they glow like
  // lines but never alias or shimmer the way 1px GL lines do. A day with two tasks has both colors flowing
  // around its outline. The active day's light is added here too, falling off onto the blocks around it.
  const shared = { uTime: { value: 0 }, uLampPos: { value: new THREE.Vector3(0, -99, 0) }, uLampCol: { value: new THREE.Color(0x8b93ff) }, uLampAmt: { value: 0 } };
  const blockMat = () => new THREE.ShaderMaterial({
    transparent: true, depthWrite: true,
    uniforms: { map: { value: null }, uEdge: { value: new THREE.Color(0x8b93ff) }, uEdge2: { value: new THREE.Color(0x8b93ff) }, uEdgeA: { value: 0.35 }, uPast: { value: 0 }, ...shared },
    vertexShader: `
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform sampler2D map; uniform vec3 uEdge, uEdge2; uniform float uEdgeA, uPast, uTime; uniform vec3 uLampPos, uLampCol; uniform float uLampAmt;
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
        bool top = N.y > .5;
        float fres = pow(1. - clamp(dot(N, V), 0., 1.), 2.);
        // distance to the face's nearest edge, in face units; fwidth keeps the line's edge soft at any scale
        float e = min(min(vUv.x, 1. - vUv.x), min(vUv.y, 1. - vUv.y));
        float fw = fwidth(e) * 1.2;
        float w = top ? .028 : .045;
        float line = 1. - smoothstep(w - fw, w + fw, e);
        float halo = exp(-e * (top ? 16. : 11.)) * .5;
        // edge color: the two task colors chase each other round the outline (same color twice = steady)
        float ang = atan(vUv.y - .5, vUv.x - .5);
        float m = smoothstep(.2, .8, .5 + .5 * sin(ang * 2. - uTime * 1.5 + vW.y * 3.));
        vec3 edge = mix(uEdge, uEdge2, m);
        // glass: deep, with a sheen toward glancing angles; the sides a little darker
        vec3 glass = mix(vec3(.075, .075, .12), vec3(.2, .2, .36), fres) * (top ? 1. : .7) * (1. - uPast * .35);
        vec4 tex = top ? texture2D(map, vUv) : vec4(0.);
        vec3 col = mix(glass, tex.rgb, tex.a);
        // the active day's light, falling off with distance
        float d = distance(vW, uLampPos);
        col += uLampCol * uLampAmt * exp(-d * d * 1.1) * (top ? .32 : .22) * (1. - tex.a * .6);
        col += edge * (line * 1.1 + halo) * uEdgeA;
        float a = top ? mix(.5, 1., tex.a) : .4 + fres * .3;
        a = clamp(max(a, (line * .9 + halo * .4) * uEdgeA), 0., 1.);
        gl_FragColor = vec4(col, a);
      }`,
  });

  const bodyGeo = new THREE.BoxGeometry(S, H, S);
  const glowGeo = new THREE.PlaneGeometry(S * 2.4, S * 2.4);
  const cells = [];
  for (let i = 0; i < ROWS * COLS; i++) {
    const col = i % COLS, row = (i / COLS) | 0;
    const grp = new THREE.Group(); grp.position.set(ox + col * (S + GAP_TILES), 0, oz + row * (S + GAP_TILES));
    const body = new THREE.Mesh(bodyGeo, blockMat());
    body.renderOrder = 10 + row;                                  // back rows first, always: transparency can't flicker
    grp.add(body); grid.add(grp);
    // its glow pool stays on the floor (not in the lifting group), drawn before the blocks
    const glow = new THREE.Mesh(glowGeo, glowMaterial(0x8b93ff, 0, 4)); glow.rotation.x = -Math.PI / 2;
    glow.position.set(grp.position.x, -H / 2 - 0.02, grp.position.z); glow.renderOrder = 1; grid.add(glow);
    cells.push({ grp, body, glow, lift: 0, color: new THREE.Color(0x8b93ff), d: null, edgeBase: 0.3 });
  }
  // weekday letters along the far edge
  WD.forEach((w, col) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.32), new THREE.MeshBasicMaterial({ map: label(w), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(ox + col * (S + GAP_TILES), H / 2, oz - S * 0.82); m.renderOrder = 5; grid.add(m);
  });

  /* the model: real dates, rebuilt every 30s; faces only redrawn when the day changes */
  let model = null, todayKey = null, order = [], active = null, k = 0, nextAt = 0.9;
  function applyModel() {
    model = buildModel(new Date());
    const newDay = dayKey(model.today) !== todayKey;
    todayKey = dayKey(model.today);
    model.cells.forEach((d, i) => {
      const c = cells[i]; c.d = d;
      const c1 = d.tasks[0] ? HEX[d.tasks[0].c] : 0x8b93ff, c2 = d.tasks[1] ? HEX[d.tasks[1].c] : c1;
      const u = c.body.material.uniforms;
      u.uEdge.value.set(c1); u.uEdge2.value.set(c2); u.uPast.value = d.past ? 1 : 0;
      c.color.set(c1).lerp(new THREE.Color(c2), 0.5);             // light / glow: a blend of the day's colors
      c.glow.material.uniforms.uC.value.copy(c.color);
      c.edgeBase = d.today ? 0.75 : d.tasks.length ? 0.6 : 0.3;     // idle edge brightness: today and task days glow a bit
      if (newDay || !u.map.value) { u.map.value?.dispose(); u.map.value = face(d); }
    });
    // popups go through the days with tasks in date order, starting from today
    const withTasks = cells.filter(c => c.d.tasks.length);
    const from = withTasks.findIndex(c => !c.d.past);
    order = from > 0 ? [...withTasks.slice(from), ...withTasks.slice(0, from)] : withTasks;
    // the day on show may have changed under it (a new day, or its last task moved): refresh it, or move on
    if (active) { if (active.d.tasks.length) fill(active); else { active = null; nextAt = 0; } }
  }

  // popup: the date, then each task's name and time (+ reminder). Same format every time.
  function fill(c) {
    const list = c.d.tasks;
    if (!list.length) return;
    popEl.style.setProperty('--c1', HEX[list[0].c]);
    popEl.innerHTML = `<div class="ph">${c.d.today ? 'Today · ' : ''}${fmtDay(c.d.date)}</div>` + list.map(t =>
      `<div class="row" style="--c:${HEX[t.c]}"><b>${esc(t.n)}</b><span>${t.dt < new Date() ? '<em>overdue</em> · ' : ''}${fmtTime(t.dt)}${t.r ? `<i>🔔 ${t.r}</i>` : ''}</span></div>`).join('');
    // side bar: one band of color per task, changing where its row starts, with a short (8px) blend
    const rows = [...popEl.querySelectorAll('.row')], len = Math.max(1, popEl.offsetHeight - 18), BL = 4;
    let bar = `${HEX[list[0].c]} 0`;
    for (let i = 1; i < rows.length; i++) {
      const at = Math.max(0, rows[i].offsetTop - 3 - 9);
      bar += `, ${HEX[list[i - 1].c]} ${Math.max(0, at - BL)}px, ${HEX[list[i].c]} ${Math.min(len, at + BL)}px`;
    }
    popEl.style.setProperty('--bar', `linear-gradient(${bar}, ${HEX[list[list.length - 1].c]} 100%)`);
  }

  // camera framing: fixed, with the grid's sway and a slow drift
  const fit = () => (COLS * (S + GAP_TILES)) / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / camera.aspect;
  let lookY = null;                                               // vertical aim; set by anchor() once per screen size
  function frame(t, sway = Math.sin(t * 0.14), drift = Math.sin(t * 0.09), tilt = Math.sin(t * 0.1)) {
    const dist = Math.max(8, fit() * 1.3);
    grid.rotation.y = sway * 0.11;
    const el = 0.88 + tilt * 0.03;                                // camera elevation: higher = less tilt, far rows closer
    camera.position.set(drift * 0.5, Math.sin(el) * dist, Math.cos(el) * dist);
    camera.lookAt(0, lookY ?? dist * 0.07, 0.2);
    camera.updateMatrixWorld();
  }
  // sit the grid (weekday letters included) just under the logo, with one line of space. Worked out once per
  // screen size with the grid at rest, not per frame, so the sway moves the grid but nothing chases it.
  function anchor() {
    const want = (logoEl ? logoEl.offsetTop + logoEl.offsetHeight : 80) + 14;
    lookY = Math.max(8, fit() * 1.3) * 0.07;
    for (let i = 0; i < 40; i++) {
      frame(0, 0, 0, 0);
      const topY = Math.min(project(ox, H / 2, oz - S * 1.0)[1], project(-ox, H / 2, oz - S * 1.0)[1]);
      lookY += (want - topY) * 0.01;                              // grid too high on screen -> aim higher, which lowers it
    }
  }

  // popups sit under their day, anchored to where the day sits when lifted, ignoring its bob, so they hold still
  const v = new THREE.Vector3();
  const project = (x, y, z) => { v.set(x, y, z); grid.localToWorld(v); v.project(camera); return [(v.x + 1) / 2 * s.view.w, (1 - v.y) / 2 * s.view.h]; };
  function place(c) {
    const W = s.view.w, pw = popEl.offsetWidth, ph = popEl.offsetHeight;
    const [ax, y] = project(c.grp.position.x, LIFT - H / 2, c.grp.position.z);
    const x = Math.max(10, Math.min(W - pw - 10, ax - pw / 2));
    popEl.style.transform = `translate3d(${x}px, ${y + GAP}px, 0)`;
    popEl.style.setProperty('--ax', `${Math.max(14, Math.min(pw - 14, ax - x))}px`);
  }



  applyModel();
  const refresh = setInterval(applyModel, 30000);
  on(document, 'visibilitychange', () => { if (!document.hidden) applyModel(); });

  s.onResize.push(() => { lookY = null; });
  s.loop((t) => {
    shared.uTime.value = t;
    if (lookY === null) anchor();
    frame(t);

    if (t > nextAt && order.length) { active = order[k++ % order.length]; fill(active); nextAt = t + SHOW_FOR; }
    const bob = Math.sin(t * 3) * 0.035;
    for (const c of cells) {
      const on1 = c === active;
      c.lift += ((on1 ? LIFT + bob : 0) - c.lift) * 0.12;
      c.grp.position.y = c.lift;
      const g = c.glow.material.uniforms.uA;
      g.value += ((on1 ? 0.6 : 0) - g.value) * 0.1;
      const ea = c.body.material.uniforms.uEdgeA;
      ea.value += ((on1 ? 1.6 : c.edgeBase) - ea.value) * 0.12;
    }
    // the colored light rides just above the active day and fades in/out with it
    if (active) {
      active.grp.getWorldPosition(v);
      shared.uLampPos.value.set(v.x, v.y + H / 2 + 0.35, v.z);
      shared.uLampCol.value.lerp(active.color, 0.12);
    }
    shared.uLampAmt.value += ((active ? 1 : 0) - shared.uLampAmt.value) * 0.08;
    if (active) place(active);
    popEl.classList.toggle('on', !!active && t < nextAt - 0.35);
  });

  return { stop() { clearInterval(refresh); s.stop(); ui.remove(); } };
}
