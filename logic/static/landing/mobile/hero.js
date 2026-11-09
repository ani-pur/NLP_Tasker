// Phone hero controller: the holo calendar by default, and a small switch (for the keen-eyed) to warp.
// The choice is remembered on this device. Switching tears the old scene down fully before the next
// one starts, and a token makes sure rapid taps on the switch can never leave two scenes running.
import { start as holo } from './hero-holo.js';
import { start as warp } from './hero-warp.js';

const host = document.getElementById('hero-stage');
const btn = document.querySelector('[data-hero-switch]');
const KEY = 'tasker-hero';
const MODES = { holo, warp };
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const save = m => { try { localStorage.setItem(KEY, m); } catch {} };

let current = null, token = 0, mode = MODES[read()] ? read() : 'holo';

async function mount(m) {
  const mine = ++token;
  current?.stop(); current = null;
  host.dataset.mode = m;
  btn.dataset.next = m === 'holo' ? 'warp' : 'calendar';
  btn.setAttribute('aria-label', `Switch the animation to ${btn.dataset.next}`);
  try {
    const scene = await MODES[m](host);
    if (mine !== token) { scene.stop(); return; }                 // another switch happened while this one loaded
    current = scene;
  } catch (e) {
    console.warn('hero failed to start', e);                      // no WebGL: the plain logo stays
  }
}

if (host && btn) {
  btn.addEventListener('click', () => { mode = mode === 'holo' ? 'warp' : 'holo'; save(mode); mount(mode); });
  mount(mode);
}
