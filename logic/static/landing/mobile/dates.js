// Date model for the phone hero (holo calendar + warp): example tasks placed relative to the real
// today, the way the "you type" readout does it (../readout.js), so the hero never shows a stale date.
// Pure: no DOM, no three.js, so it can be tested on its own (see the test notes in the commit/PR).
//
// The calendar is a rolling 5-week window, not a month page: it starts on the Sunday of last week, so
// today is always in the second row and every example (yesterday .. +2 weeks) always fits on it.
// Nothing ever lands in the bottom row (the popups hang under their day): from any weekday, +14 days
// is at most row 4 of 5, so no example goes further out than that.
//
// All date math is on local calendar days (new Date(y, m, d + n)), never by adding 24h of milliseconds,
// so DST changes can't shift a task to the wrong day or hour.

export const WEEKS = 5;

// off: days from today; dow: the next given weekday (0 = Sun), never today, like "next monday"
export const TEMPLATES = [
  { n: 'Problem set 2', c: 'blue', d: 'questions 1-6, show work', off: -1, h: 23, m: 59 },
  { n: 'Grocery run', c: 'yellow', d: 'milk, eggs, chicken, rice', off: 0, h: 18, m: 0 },
  { n: 'Standup notes', c: 'green', d: 'blockers for the sync', off: 1, h: 9, m: 30 },
  { n: 'Call mom', c: 'pink', d: 'about weekend plans', off: 1, h: 12, m: 0, r: '30m' },
  { n: 'Movie night', c: 'pink', d: '', off: 3, h: 20, m: 0 },
  { n: 'Leg day at the gym', c: 'blue', d: 'legs, focus on squats', dow: 1, h: 7, m: 0, r: '1h' },
  { n: 'Oil change', c: 'orange', d: 'bring the coupon', dow: 1, h: 10, m: 0 },
  { n: 'Midterm review', c: 'purple', d: 'chapters 4-7', off: 9, h: 16, m: 0 },
  { n: 'Project demo', c: 'red', d: 'slides + live run', off: 13, h: 14, m: 0 },
  { n: 'Flight to Austin', c: 'yellow', d: 'terminal E', off: 14, h: 7, m: 40, r: '2h' },
];

export const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const dayKey = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
export const untilDow = (from, dow) => ((dow - from.getDay() + 7) % 7) || 7;
// whole calendar days from a to b (DST-proof: both pinned to noon)
export const daysBetween = (a, b) => Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate(), 12) - new Date(a.getFullYear(), a.getMonth(), a.getDate(), 12)) / 864e5);

export const fmtTime = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
export const fmtDay = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
export const fmtMonthDay = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// "Today", "Tomorrow", "Yesterday", "Mon" (within the coming week), else "Mon, Nov 23"
export function relDay(date, now) {
  const n = daysBetween(now, date);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return WD[date.getDay()];
  return fmtDay(date);
}

// the month(s) the window covers: "November 2026", "Nov – Dec 2026", "Dec 2026 – Jan 2027"
function rangeLabel(a, b) {
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return a.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const m = d => d.toLocaleDateString('en-US', { month: 'short' });
  if (a.getFullYear() === b.getFullYear()) return `${m(a)} – ${m(b)} ${a.getFullYear()}`;
  return `${m(a)} ${a.getFullYear()} – ${m(b)} ${b.getFullYear()}`;
}

export function buildModel(now = new Date()) {
  const today = dayStart(now);
  const start = addDays(today, -7 - today.getDay());           // Sunday of last week
  const cells = [];
  for (let i = 0; i < WEEKS * 7; i++) {
    const date = addDays(start, i);
    cells.push({
      i, row: (i / 7) | 0, col: i % 7, date, key: dayKey(date),
      today: sameDay(date, today), past: date < today, monthStart: date.getDate() === 1, tasks: [],
    });
  }
  const byKey = Object.fromEntries(cells.map(c => [c.key, c]));
  const tasks = TEMPLATES.map((t, id) => {
    const day = addDays(today, t.dow !== undefined ? untilDow(today, t.dow) : t.off);
    const dt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), t.h, t.m);
    return { ...t, id, dt, key: dayKey(dt), overdue: dt < now, when: `${relDay(dt, now)} · ${fmtTime(dt)}` };
  });
  for (const t of tasks) byKey[t.key]?.tasks.push(t);
  for (const c of cells) c.tasks.sort((a, b) => a.dt - b.dt);
  return { now, today, start, end: cells[cells.length - 1].date, cells, tasks, label: rangeLabel(start, cells[cells.length - 1].date) };
}
