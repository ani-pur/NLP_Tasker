// Phone demo for landing_mobile.html: a working copy of glass_mobile (the glass theme on a phone).
// It types an example into the New Task box, taps Add, then scrolls down to the new card and opens
// it, the way you'd check it landed, then scrolls back up for the next one. Tapping any card opens
// or closes it, like the real thing. Same fixed timeline as ../glassdemo.js (Tue Mar 10 2026,
// 10:12 AM) and the same tasks, so the phone and desktop demos tell one story.
(function () {
  const mount = document.getElementById('pdemo');
  if (!mount) return;

  const HEX = { blue: '#87CEEB', red: '#f05656', green: '#6CE5A9', pink: '#F8C8DC', orange: '#ff7f00', purple: '#A96CE5', yellow: '#FDDA0D' };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const DEMO_NOW = new Date(2026, 2, 10, 10, 12);
  const booted = Date.now();
  const demoNow = () => new Date(DEMO_NOW.getTime() + (Date.now() - booted));
  function at(off, h, m) { const d = new Date(DEMO_NOW); d.setHours(h, m, 0, 0); d.setDate(d.getDate() + off); return d; }
  function until(dow) { return ((dow - DEMO_NOW.getDay() + 7) % 7) || 7; }

  const SEED = [
    { name: 'Problem set 2', desc: 'questions 1-6, show work', color: 'blue', dt: () => at(-1, 23, 59) },
    { name: 'Standup notes', desc: 'blockers for the sync', color: 'green', dt: () => at(1, 9, 30) },
    { name: 'Movie night', desc: '', color: 'pink', dt: () => at(3, 20, 0) },
    { name: 'Oil change', desc: 'bring the coupon', color: 'orange', dt: () => at(6, 10, 0), rem: '1h' },
    { name: 'Midterm review', desc: 'chapters 4-7', color: 'purple', dt: () => at(9, 16, 0) },
    { name: 'Project demo', desc: 'slides + live run', color: 'red', dt: () => at(13, 14, 0) },
    { name: 'Flight to Austin', desc: 'terminal E', color: 'yellow', dt: () => at(17, 7, 40), rem: '2h' },
  ];
  const EXAMPLES = [
    { text: 'gym next monday 7am legs, focus on squats, blue, remind me 30 min before', name: 'Leg day at the gym', desc: 'legs, focus on squats', color: 'blue', dt: () => at(until(1), 7, 0), rem: '30m' },
    { text: 'groceries tomorrow evening yellow, milk eggs chicken rice', name: 'Grocery run', desc: 'milk, eggs, chicken, rice', color: 'yellow', dt: () => at(1, 18, 0) },
    { text: 'submit lab report friday midnight on canvas, purple, remind me at 5pm', name: 'Submit lab report', desc: 'submit on canvas', color: 'purple', dt: () => at(until(5), 23, 59), rem: '5PM' },
    { text: 'call mom tomorrow at noon about thanksgiving plans, pink', name: 'Call mom', desc: 'about thanksgiving plans', color: 'pink', dt: () => at(1, 12, 0) },
    { text: 'dentist next tuesday 9am cleaning, red, remind me 1h before', name: 'Dentist', desc: 'cleaning', color: 'red', dt: () => at(until(2), 9, 0), rem: '1h' },
  ];
  const CHEV = '<svg class="pd-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

  mount.innerHTML = `
    <div class="pd" aria-label="Tasker on a phone, live demo">
      <div class="pd-screen">
        <div class="pd-blob b1"><i></i></div><div class="pd-blob b2"><i></i></div><div class="pd-blob b3"><i></i></div><div class="pd-blob b4"><i></i></div>
        <div class="pd-island"></div>
        <div class="pd-status"><span>9:41</span><span class="pd-sig"><i></i><i></i><i></i><i></i><span class="pd-batt"></span></span></div>
        <div class="pd-head">
          <div class="pd-logo">tasker<i>.</i><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></div>
          <div class="pd-nav"><span>Calendar</span><span class="pd-chip">anirudh</span><span class="pd-exit">Exit</span></div>
        </div>
        <div class="pd-scroll"><div class="pd-main">
          <div class="pd-input">
            <h4>New Task</h4>
            <p>Just type. Dates, times, colors, reminders — Tasker extracts everything.</p>
            <div class="pd-ta"><span class="pd-typed"></span><span class="pd-caret"></span></div>
            <div class="pd-acts"><span class="pd-count">0/200</span><span class="pd-rem"></span></div>
            <div class="pd-add">Add Task</div>
          </div>
          <div class="pd-stats">
            <div class="pd-stat"><b style="color:#818cf8" data-s="up">0</b><span>Active</span></div>
            <div class="pd-stat"><b style="color:#f87171" data-s="od">0</b><span>Overdue</span></div>
            <div class="pd-stat"><b style="color:#34d399" data-s="all">0</b><span>Total</span></div>
          </div>
          <div class="pd-thead">
            <div><span class="pd-title">Tasks</span><span class="pd-badge">0</span></div>
            <div class="pd-clock"><div class="d"></div><div class="t"></div></div>
          </div>
          <div class="pd-list"></div>
        </div></div>
        <div class="pd-home"></div>
      </div>
    </div>`;

  const $ = s => mount.querySelector(s);
  const main = $('.pd-main'), scroller = $('.pd-scroll'), list = $('.pd-list');
  const ta = $('.pd-ta'), typed = $('.pd-typed'), count = $('.pd-count'), remPill = $('.pd-rem'), addBtn = $('.pd-add');

  /* clock, in glass_mobile's format: "TUE, MAR 10" over "10:12 AM" */
  function clock() {
    const now = demoNow();
    const day = now.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    const mon = now.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    $('.pd-clock .d').textContent = `${day}, ${mon} ${String(now.getDate()).padStart(2, '0')}`;
    $('.pd-clock .t').textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  }
  clock(); setInterval(clock, 15000);

  /* tasks */
  let tasks = [], nextId = 1;
  const open = new Set();
  const mk = t => ({ ...t, id: nextId++, dt: t.dt() });
  const when = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  function cardHtml(t, od, isNew) {
    return `<div class="pd-card${od ? ' od' : ''}${open.has(t.id) ? ' open' : ''}${isNew ? ' new' : ''}" style="--c:${HEX[t.color]}" data-id="${t.id}">
      <div class="pd-chead"><div class="pd-cmain">
        <div class="pd-name">${esc(t.name)}</div>
        <div class="pd-meta"><span class="pd-pill${od ? ' od' : ''}">${when(t.dt)}</span>${t.rem ? `<span class="pd-pill bell">🔔 ${t.rem}</span>` : ''}</div>
      </div>${CHEV}</div>
      <div class="pd-body"><div><div class="pd-exp">
        <div${t.desc ? '' : ' class="empty"'}>${t.desc ? esc(t.desc) : 'No details'}</div>
        <div class="pd-btns"><span class="e">edit</span><span class="x">delete</span></div>
      </div></div></div>
    </div>`;
  }

  // like glass_mobile: past-due tasks first, then the "Past Due" divider, then upcoming
  function render(newId) {
    const now = demoNow();
    const sorted = [...tasks].sort((a, b) => a.dt - b.dt);
    const past = sorted.filter(t => t.dt < now), up = sorted.filter(t => t.dt >= now);
    list.innerHTML = past.map(t => cardHtml(t, true, t.id === newId)).join('')
      + (past.length ? '<div class="pd-div"><span>Past Due</span></div>' : '')
      + up.map(t => cardHtml(t, false, t.id === newId)).join('');
    $('[data-s="up"]').textContent = up.length;
    $('[data-s="od"]').textContent = past.length;
    $('[data-s="all"]').textContent = tasks.length;
    $('.pd-badge').textContent = tasks.length;
  }

  list.addEventListener('click', e => {
    const card = e.target.closest('.pd-card');
    if (!card) return;
    const id = +card.dataset.id;
    if (card.classList.toggle('open')) open.add(id); else open.delete(id);
  });

  // the page scrolls by moving its content up (the frame never scrolls, so it can't trap a swipe)
  function scrollTo(y) {
    const max = Math.max(0, main.scrollHeight - scroller.clientHeight);
    main.style.transform = `translateY(${-Math.min(max, Math.max(0, y))}px)`;
  }

  function remDisplay(t) {
    let m = t.match(/remind me (\d+)\s*(min|h)\w*\s+before/);
    if (m) return m[1] + (m[2] === 'min' ? 'm' : 'h');
    m = t.match(/remind me at (\d{1,2})(?::(\d\d))?\s*(am|pm)\b/);
    if (m) return m[1] + (m[2] ? ':' + m[2] : '') + m[3].toUpperCase();
    return null;
  }
  function setText(s) {
    typed.innerHTML = s ? esc(s) : '';
    count.textContent = `${s.length}/200`;
    const col = s.toLowerCase().match(/\b(blue|red|green|pink|orange|purple|yellow)\b/g);
    typed.style.color = col ? `color-mix(in srgb, ${HEX[col[col.length - 1]]} 70%, var(--fg))` : '';
    const r = remDisplay(s);
    remPill.classList.toggle('on', !!r);
    remPill.textContent = r ? `🔔 ${r}` : '';
  }

  function reset() {
    nextId = 1; open.clear();
    tasks = SEED.map(mk);
    render();
    scrollTo(0);
  }

  // like the real dashboard's ambientPulse (static/ambient.js): after a task is added, the blobs fade
  // most of the way to its color (0.7s), hold (1.3s), and fade back (1.4s)
  const tints = [...mount.querySelectorAll('.pd-blob > i')];
  const reduceTint = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function pulse(hex) {
    if (reduceTint || !tints[0]?.animate) return;
    for (const el of tints) {
      el.style.setProperty('--tint', hex || '#D3D8EE');
      el.getAnimations().forEach(a => a.cancel());
      el.animate([{ opacity: 0 }, { opacity: 0.8, offset: 0.7 / 3.4 }, { opacity: 0.8, offset: 2 / 3.4 }, { opacity: 0 }], { duration: 3400, easing: 'ease-in-out' });
    }
  }

  async function loop() {
    reset();
    await sleep(1000);
    for (;;) {
      for (const ex of EXAMPLES) {
        ta.classList.add('focus');
        for (let i = 1; i <= ex.text.length; i++) { setText(ex.text.slice(0, i)); await sleep(reduce ? 4 : 36 + Math.random() * 32); }
        await sleep(500);
        addBtn.classList.add('press'); await sleep(140); addBtn.classList.remove('press');
        ta.classList.remove('focus');
        setText('');
        const t = mk(ex);
        tasks.push(t);
        pulse(HEX[t.color]);
        render(t.id);
        // go look at it: scroll it into the middle of the screen and open it
        await sleep(450);
        const card = list.querySelector(`[data-id="${t.id}"]`);
        // offsetTop ignores the transform: both are measured from the screen's top, before any scroll
        scrollTo(card.offsetTop - scroller.offsetTop - scroller.clientHeight / 2 + card.offsetHeight);
        await sleep(1000);
        card.classList.add('open'); open.add(t.id);
        await sleep(2400);
        card.classList.remove('open'); open.delete(t.id);
        await sleep(400);
        scrollTo(0);
        await sleep(1100);
      }
      await sleep(1200);
      reset();
      await sleep(1000);
    }
  }
  loop();
})();
