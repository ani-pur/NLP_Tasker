// Glass-only live demo: types example tasks into a desktop_v6 replica, and each one lands in
// the task list and on the calendar. It runs on its own fixed timeline (DEMO_NOW), not the real
// date, so the calendar never changes month and every example lands inside it.
(function () {
  const mount = document.getElementById('gdemo');
  if (!mount) return;

  const HEX = { blue: '#87CEEB', red: '#f05656', green: '#6CE5A9', pink: '#F8C8DC', orange: '#ff7f00', purple: '#A96CE5', yellow: '#FDDA0D' };
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const WARN = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4"/><path d="M12 17.2h.01" stroke-width="3"/></svg>';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const key = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

  // The demo's "now": Tue Mar 10 2026, 10:12 AM. Mid-month in a month that starts on a Sunday,
  // so every seed and example (up to +17 days) fits in one 5-row calendar. demoNow() ticks forward
  // with real time so the clock still moves.
  const DEMO_NOW = new Date(2026, 2, 10, 10, 12);
  const booted = Date.now();
  const demoNow = () => new Date(DEMO_NOW.getTime() + (Date.now() - booted));
  // a date `off` days from the demo's today at h:m
  function at(off, h, m) { const d = new Date(DEMO_NOW); d.setHours(h, m, 0, 0); d.setDate(d.getDate() + off); return d; }
  // days until the next given weekday (0=Sun), never today
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

  mount.innerHTML = `
    <div class="gd">
      <div class="gd-blob b1"></div><div class="gd-blob b2"></div><div class="gd-blob b3"></div><div class="gd-blob b4"></div>
      <div class="gd-bar">
        <div class="gd-brand">tasker<i>.</i></div>
        <div class="gd-barr"><span class="gd-user">anirudh</span><span>Log out</span></div>
      </div>
      <div class="gd-body">
        <div class="gd-left">
          <section class="gd-pane gd-composer">
            <div class="gd-ctitle"><h4>New task</h4><span>just type it how you'd say it</span></div>
            <div class="gd-fog">
              <div class="gd-input empty"><span class="gd-typed"></span><span class="gd-caret"></span></div>
              <div class="gd-cbar"><span class="gd-count">0/200</span><span class="gd-rem"></span><span class="gd-sp"></span><span class="gd-add">Add task</span></div>
            </div>
          </section>
          <section class="gd-pane gd-list">
            <div class="gd-lhead">
              <div class="gd-ltitle">Tasks<span class="gd-n">0</span></div>
              <div class="gd-clock"><span class="gd-t"></span><span class="gd-d"></span></div>
            </div>
            <div class="gd-cards"></div>
          </section>
        </div>
        <section class="gd-pane gd-cal">
          <div class="gd-ctool">
            <div>
              <div><span class="gd-month"></span><span class="gd-year"></span></div>
              <div class="gd-stats"><span class="gd-stat"><b class="gd-up">0</b> upcoming</span><span class="gd-stat od"><b class="gd-od">0</b> overdue</span></div>
            </div>
            <div class="gd-seg"><span>‹</span><span>Today</span><span>›</span></div>
          </div>
          <div class="gd-wd">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(w => `<span>${w}</span>`).join('')}</div>
          <div class="gd-grid"></div>
        </section>
      </div>
    </div>`;

  const $ = s => mount.querySelector(s);
  const input = $('.gd-input'), typed = $('.gd-typed'), count = $('.gd-count'), remPill = $('.gd-rem');
  const cards = $('.gd-cards'), grid = $('.gd-grid');

  /* clock */
  function clock() {
    const now = demoNow();
    const parts = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).formatToParts(now);
    $('.gd-t').innerHTML = parts.filter(p => p.type !== 'dayPeriod').map(p => p.value).join('').trim() + `<em>${parts.find(p => p.type === 'dayPeriod').value}</em>`;
    $('.gd-d').textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  clock(); setInterval(clock, 15000);

  /* task state */
  let tasks = [], nextId = 1;
  const view = new Date(DEMO_NOW);                              // the calendar stays on the demo's month
  const mk = t => ({ ...t, id: nextId++, dt: t.dt() });
  const time12 = d => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const chipTime = d => { const h = d.getHours() % 12 || 12, m = d.getMinutes(); return `${h}${m ? ':' + String(m).padStart(2, '0') : ''}${d.getHours() < 12 ? 'am' : 'pm'}`; };

  function cardHtml(t, isNew) {
    const od = t.dt < demoNow();
    const when = t.dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + time12(t.dt);
    return `<div class="gd-card${od ? ' od' : ''}${isNew ? ' new' : ''}" style="--c:${HEX[t.color]}" data-key="${key(t.dt)}" data-id="${t.id}">
      <div class="gd-name">${esc(t.name)}</div>
      ${t.desc ? `<div class="gd-desc">${esc(t.desc)}</div>` : ''}
      <div class="gd-meta"><span class="gd-pill when">${when}</span>${t.rem ? `<span class="gd-pill bell">⏰ ${t.rem}</span>` : ''}</div>
    </div>`;
  }

  function renderList(newId) {
    const now = demoNow();
    const sorted = [...tasks].sort((a, b) => a.dt - b.dt);
    const past = sorted.filter(t => t.dt < now), up = sorted.filter(t => t.dt >= now);
    cards.innerHTML =
      (past.length ? `<div class="gd-div od"><span>Past due</span></div>` + past.map(t => cardHtml(t, t.id === newId)).join('') : '') +
      (up.length ? `<div class="gd-div"><span>Upcoming</span></div>` + up.map(t => cardHtml(t, t.id === newId)).join('') : '');
    $('.gd-n').textContent = tasks.length;
    $('.gd-up').textContent = up.length;
    $('.gd-od').textContent = past.length;
    $('.gd-od').parentElement.classList.toggle('zero', past.length === 0);
    const fresh = cards.querySelector('.new');
    if (fresh) cards.scrollTop = fresh.offsetTop - 60;
  }

  function renderCal(bumpKey) {
    const y = view.getFullYear(), m = view.getMonth();
    const first = new Date(y, m, 1).getDay();
    const rows = Math.ceil((first + new Date(y, m + 1, 0).getDate()) / 7);
    grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
    $('.gd-month').textContent = MONTHS[m];
    $('.gd-year').textContent = y;
    const byDay = {};
    [...tasks].sort((a, b) => a.dt - b.dt).forEach(t => (byDay[key(t.dt)] ||= []).push(t));
    const todayKey = key(DEMO_NOW), now = demoNow();
    const maxChips = rows > 5 ? 2 : 3;
    let html = '';
    for (let i = 0; i < rows * 7; i++) {
      const d = new Date(y, m, 1 - first + i), k = key(d), col = i % 7;
      const list = byDay[k] || [];
      const extra = list.length - maxChips;
      const cls = ['gd-cell', col === 0 || col === 6 ? 'we' : '', d.getMonth() !== m ? 'out' : '', k === todayKey ? 'today' : '', k === bumpKey ? 'bump' : ''].join(' ');
      html += `<div class="${cls}" data-key="${k}">
        <div class="gd-num"><span class="n">${d.getDate()}</span>${extra > 0 ? `<span class="more">+${extra}</span>` : ''}</div>
        ${list.slice(0, maxChips).map(t => {
          const od = t.dt < now;
          return `<div class="gd-chip${od ? ' od' : ''}" style="--c:${HEX[t.color]}">${od ? WARN : ''}<span class="at">${chipTime(t.dt)}</span><span class="l">${esc(t.name)}</span></div>`;
        }).join('')}
      </div>`;
    }
    grid.innerHTML = html;
  }

  // hovering a task lights up its day, like the real dashboard
  cards.addEventListener('mouseover', e => {
    const card = e.target.closest('.gd-card');
    grid.querySelectorAll('.linked').forEach(c => c.classList.remove('linked'));
    if (card) grid.querySelector(`.gd-cell[data-key="${card.dataset.key}"]`)?.classList.add('linked');
  });
  cards.addEventListener('mouseleave', () => grid.querySelectorAll('.linked').forEach(c => c.classList.remove('linked')));

  /* composer */
  function remDisplay(t) {
    let m = t.match(/remind me (\d+)\s*(min|h)\w*\s+before/);
    if (m) return m[1] + (m[2] === 'min' ? 'm' : 'h');
    m = t.match(/remind me at (\d{1,2})(?::(\d\d))?\s*(am|pm)\b/);
    if (m) return m[1] + (m[2] ? ':' + m[2] : '') + m[3].toUpperCase();
    return null;
  }
  function setText(s) {
    typed.textContent = s;
    input.classList.toggle('empty', !s);
    count.textContent = `${s.length}/200`;
    const col = s.toLowerCase().match(/\b(blue|red|green|pink|orange|purple|yellow)\b/g);
    typed.style.color = col ? `color-mix(in srgb, ${HEX[col[col.length - 1]]} 70%, var(--fg))` : '';
    const r = remDisplay(s);
    remPill.classList.toggle('on', !!r);
    remPill.textContent = r ? `⏰ ${r}` : '';
  }

  function reset() {
    nextId = 1;
    tasks = SEED.map(mk);
    renderList();
    renderCal();
  }

  async function loop() {
    reset();
    await sleep(900);
    for (;;) {
      for (const ex of EXAMPLES) {
        for (let i = 1; i <= ex.text.length; i++) { setText(ex.text.slice(0, i)); await sleep(38 + Math.random() * 34); }
        await sleep(450);
        const btn = $('.gd-add');
        btn.classList.add('press'); await sleep(140); btn.classList.remove('press');
        setText('');
        const t = mk(ex);
        tasks.push(t);
        renderList(t.id);
        renderCal(key(t.dt));
        await sleep(2600);
      }
      await sleep(1500);
      reset();
      await sleep(1200);
    }
  }
  loop();
})();
