// Shared three.js setup for the phone hero (hero-holo.js, hero-warp.js): a renderer sized to the stage,
// paused while the stage is off screen, and a full teardown (stop) so the hero switch can swap scenes
// without leaking WebGL contexts or listeners.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
export { THREE };

export const HEX = { blue: '#87CEEB', red: '#f05656', green: '#6CE5A9', pink: '#F8C8DC', orange: '#ff7f00', purple: '#A96CE5', yellow: '#FDDA0D' };

export function stage(host, { fov = 40, dprCap = 2 } = {}) {
  const tier = (window.gpuTier || { tier: 1 }).tier;
  const ac = new AbortController(), signal = ac.signal;          // every listener added through `on` goes away on stop()
  const on = (target, type, fn, opts = {}) => target.addEventListener(type, fn, { ...opts, signal });
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, tier === 0 ? 2 : 3, dprCap));   // sharp on 3x phones; only weak devices drop to 2x
  renderer.setClearColor(0x07070a, 1);                           // opaque in the page color: additive glows just add light
  renderer.domElement.className = 'gl';
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 400);
  const view = { w: 1, h: 1 }, onResize = [];
  function size() {
    view.w = host.clientWidth || 1; view.h = host.clientHeight || 1;
    renderer.setSize(view.w, view.h, false);
    camera.aspect = view.w / view.h; camera.updateProjectionMatrix();
    onResize.forEach(f => f(view));
  }
  const ro = new ResizeObserver(size); ro.observe(host);
  let visible = true;
  const io = new IntersectionObserver(e => { visible = e[0].isIntersecting; }); io.observe(host);
  on(host, 'contextmenu', e => e.preventDefault());               // press-and-hold is an interaction here, not a menu

  let started = false;
  function loop(fn) {
    size();
    const t0 = performance.now(); let prev = t0;
    renderer.setAnimationLoop(() => {
      const now = performance.now();                            // one clock for everything (rAF's own timestamp can be on another base)
      if (!visible || document.hidden) { prev = now; return; }
      const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
      fn((now - t0) / 1000, dt);
      renderer.render(scene, camera);
      if (!started) { started = true; host.classList.add('live'); }
    });
  }
  function stop() {
    ac.abort(); ro.disconnect(); io.disconnect();
    renderer.setAnimationLoop(null);
    scene.traverse(o => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material || [])) { for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); m.uniforms && Object.values(m.uniforms).forEach(u => u.value?.isTexture && u.value.dispose()); m.dispose(); }
    });
    renderer.dispose(); renderer.forceContextLoss();
    renderer.domElement.remove();
    host.classList.remove('live');
  }
  return { THREE, renderer, scene, camera, loop, stop, on, tier, view, onResize, signal };
}

// soft round glow, for under/behind things (additive)
export function glowMaterial(color, strength = 1, falloff = 4) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uA: { value: strength }, uC: { value: new THREE.Color(color) } },
    vertexShader: 'varying vec2 u; void main(){ u = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `uniform float uA; uniform vec3 uC; varying vec2 u; void main(){ float d = length(u - .5) * 2.; gl_FragColor = vec4(uC * exp(-d * d * ${falloff.toFixed(1)}) * uA, 1.); }`,
  });
}

export const fontsReady = () => Promise.all([
  document.fonts.load('600 50px "Instrument Sans"'), document.fonts.load('500 30px "IBM Plex Mono"'),
]).catch(() => {});
