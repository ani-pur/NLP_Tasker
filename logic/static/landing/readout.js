// "You type" readout: types an example at a readable pace, and each row fills in the moment the
// words it comes from have been typed. A bar drains from full to empty across the whole example
// (typing + hold); the next example starts when it runs out. A button pauses the whole thing (typing and
// bar). Dates resolve against the real today, like the app does.
(function () {
  const root = document.getElementById('readout');
  if (!root) return;

  const HEX = { blue: '#87CEEB', red: '#f05656', green: '#6CE5A9', pink: '#F8C8DC', orange: '#ff7f00', purple: '#A96CE5', yellow: '#FDDA0D' };
  const HOLD = 8000;                                         // ms the finished example stays up
  // pausable: time only counts down while playing
  let paused = false, wake = null, barAnim = null;
  async function sleep(ms) {
    while (ms > 0) {
      if (paused) await new Promise(r => { wake = r; });
      const t0 = performance.now();
      await new Promise(r => setTimeout(r, Math.min(ms, 50)));
      ms -= performance.now() - t0;
    }
  }
  const day = off => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + off); return d; };
  const until = dow => ((dow - new Date().getDay() + 7) % 7) || 7;
  const t12 = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const fmtDay = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  // each step: once `on` has been typed, merge `set` into what Tasker knows so far
  const EXAMPLES = [
    { text: 'gym next monday 7am legs, blue, remind me 1h before', steps: [
      ['gym', { name: 'Gym' }], ['next monday', { date: () => day(until(1)) }], ['7am', { time: [7, 0] }],
      ['legs', { name: 'Leg day at the gym' }], ['blue', { color: 'blue' }],
      ['remind me 1h before', { custom: { before: 60, label: '1h before' } }]] },
    { text: 'groceries tomorrow evening yellow, milk eggs rice', steps: [
      ['groceries', { name: 'Groceries' }], ['tomorrow', { date: () => day(1) }], ['evening', { time: [18, 0] }],
      ['yellow', { color: 'yellow' }], ['milk eggs rice', { name: 'Grocery run: milk, eggs, rice' }]] },
    { text: 'submit lab report friday midnight, purple, remind me at 5pm', steps: [
      ['submit lab report', { name: 'Submit lab report' }], ['friday', { date: () => day(until(5)) }], ['midnight', { time: [23, 59] }],
      ['purple', { color: 'purple' }], ['remind me at 5pm', { custom: { at: [17, 0], label: 'your custom reminder' } }]] },
    { text: 'call mom tomorrow at noon, pink, remind me 30 min before', steps: [
      ['call mom', { name: 'Call mom' }], ['tomorrow', { date: () => day(1) }], ['noon', { time: [12, 0] }],
      ['pink', { color: 'pink' }], ['remind me 30 min before', { custom: { before: 30, label: '30 min before' } }]] },
    { text: 'dentist next tuesday 9am cleaning, red', steps: [
      ['dentist', { name: 'Dentist' }], ['next tuesday', { date: () => day(until(2)) }], ['9am', { time: [9, 0] }],
      ['cleaning', { name: 'Dentist: cleaning' }], ['red', { color: 'red' }]] },
  ];

  const $ = s => root.querySelector(s);
  const typed = $('[data-typed]'), bar = $('[data-bar]');
  const field = name => $(`[data-f="${name}"]`);

  // swap a row's value in place (a short fade-in, no layout change)
  function set(name, html, color) {
    const el = field(name);
    if (el.dataset.html === html) return;
    el.dataset.html = html;
    el.innerHTML = `<span class="v">${html}</span>`;
    el.style.color = color || '';
  }

  function render(k) {
    const empty = '<span class="nil">—</span>';
    set('task', k.name ? k.name : empty, k.color ? `color-mix(in srgb, ${HEX[k.color]} 75%, var(--fg))` : '');
    let due = empty;
    if (k.date || k.time) {
      const d = k.date ? new Date(k.date) : null;
      if (d && k.time) d.setHours(k.time[0], k.time[1]);
      due = (d ? fmtDay(d) : '<span class="nil">day?</span>') + ' · ' + (k.time ? t12(new Date(2000, 0, 1, ...k.time)) : '<span class="nil">11:59 PM</span>');
    }
    set('due', due);
    set('color', k.color ? `<span class="sw" style="background:${HEX[k.color]}"></span>${k.color}` : empty);
    let rems = empty;
    if (k.time) {
      const at = new Date(2000, 0, 1, ...k.time), minus = m => new Date(at.getTime() - m * 60000);
      const list = [[minus(180), 'def', '3h before · default, baked in'], [at, '', 'at due time']];
      if (k.custom) list.push([k.custom.at ? new Date(2000, 0, 1, ...k.custom.at) : minus(k.custom.before), 'custom', k.custom.label]);
      list.sort((a, b) => a[0] - b[0]);                          // in the order they'll fire
      rems = list.map(([d, cls, label]) => `<div class="${cls}"><b>${t12(d)}</b><i>${label}</i></div>`).join('');
    }
    set('rem', rems);
  }

  const toggle = $('[data-toggle]');
  toggle.addEventListener('click', () => {
    paused = !paused;
    toggle.setAttribute('aria-pressed', paused);
    toggle.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    root.classList.toggle('paused', paused);
    if (paused) barAnim?.pause(); else { barAnim?.play(); wake?.(); wake = null; }
  });

  function paint(s) {
    typed.textContent = s;
    const m = s.toLowerCase().match(/\b(blue|red|green|pink|orange|purple|yellow)\b/g);
    typed.style.color = m ? `color-mix(in srgb, ${HEX[m[m.length - 1]]} 75%, var(--fg))` : '';
  }

  (async function loop() {
    for (let i = 0; ; i = (i + 1) % EXAMPLES.length) {
      const ex = EXAMPLES[i];
      const known = {};
      render(known);
      // per-character delays up front, so the bar can run over the whole example
      const delays = [...ex.text].map(ch => ch === ' ' ? 150 : ch === ',' ? 320 : 85 + Math.random() * 50);
      const total = delays.reduce((a, b) => a + b, 0) + HOLD;
      barAnim?.cancel();
      barAnim = bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: total, easing: 'linear', fill: 'forwards' });
      if (paused) barAnim.pause();
      for (let n = 1; n <= ex.text.length; n++) {
        const s = ex.text.slice(0, n);
        paint(s);
        // a step fires once its words are complete (followed by a space/comma or the end)
        let changed = false;
        for (const [on, upd] of ex.steps) {
          const at = s.indexOf(on);
          if (at < 0) continue;
          const after = s[at + on.length];
          if (after !== undefined && /[a-z0-9]/i.test(after)) continue;
          if (!upd._applied) {
            for (const [key, v] of Object.entries(upd)) if (!key.startsWith('_')) known[key] = typeof v === 'function' ? v() : v;
            upd._applied = true; changed = true;
          }
        }
        if (changed) render(known);
        await sleep(delays[n - 1]);
      }
      ex.steps.forEach(([, upd]) => { delete upd._applied; });
      await sleep(HOLD);                                        // bar finishes draining here
      for (let n = ex.text.length; n >= 0; n--) { paint(ex.text.slice(0, n)); await sleep(9); }
      await sleep(250);
    }
  })();
})();
