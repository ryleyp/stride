// 9-week run/walk 5K plan (three sessions a week). Segment spec: u=warm-up walk, r=run, w=walk, c=cool-down walk, in minutes.
import { getSettings, setSettings, lsGet, lsSet, dayKey, addDays, keyToDate, fmtDurLong } from './util.js';
import { store } from './store.js';
import { isRunLike } from './util.js';

const WEEKS = [
  { focus: 'Get moving. Short jogs, plenty of walking.', sessions: ['u5,(r1,w1.5)x8,c5', 'u5,(r1,w1.5)x8,c5', 'u5,(r1,w1.5)x8,c5'] },
  { focus: 'Slightly longer runs, longer walks to recover.', sessions: ['u5,(r1.5,w2)x6,c5', 'u5,(r1.5,w2)x6,c5', 'u5,(r1.5,w2)x6,c5'] },
  { focus: 'First three-minute runs.', sessions: ['u5,(r1.5,w1.5,r3,w3)x2,c5', 'u5,(r1.5,w1.5,r3,w3)x2,c5', 'u5,(r1.5,w1.5,r3,w3)x2,c5'] },
  { focus: 'Five-minute runs arrive.', sessions: ['u5,r3,w1.5,r5,w2.5,r3,w1.5,r5,c5', 'u5,r3,w1.5,r5,w2.5,r3,w1.5,r5,c5', 'u5,r3,w1.5,r5,w2.5,r3,w1.5,r5,c5'] },
  { focus: 'The big step: a 20-minute run on day three.', sessions: ['u5,(r5,w3)x3,c5', 'u5,r8,w5,r8,c5', 'u5,r20,c5'] },
  { focus: 'Consolidate. Last of the walk breaks.', sessions: ['u5,r5,w3,r8,w3,r5,c5', 'u5,r10,w3,r10,c5', 'u5,r25,c5'] },
  { focus: 'Continuous running, easy pace.', sessions: ['u5,r25,c5', 'u5,r25,c5', 'u5,r25,c5'] },
  { focus: 'Stretch the run to 28 minutes.', sessions: ['u5,r28,c5', 'u5,r28,c5', 'u5,r28,c5'] },
  { focus: 'Race week. Two easy 30s, then the 5K.', sessions: ['u5,r30,c5', 'u5,r30,c5', 'u10,r30,c5'] },
];
const DAY_OFFSETS = [0, 2, 4];
const KIND = { u: 'warmup', r: 'run', w: 'walk', c: 'cooldown' };

export function parseSegments(spec) {
  const out = [];
  const expand = (s) => {
    const tokens = []; let depth = 0, cur = '';
    for (const ch of s) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { tokens.push(cur); cur = ''; } else cur += ch;
    }
    if (cur) tokens.push(cur);
    for (const t of tokens) {
      const g = t.match(/^\((.*)\)x(\d+)$/);
      if (g) { for (let i = 0; i < +g[2]; i++) expand(g[1]); continue; }
      const m = t.match(/^([urwc])([\d.]+)$/);
      if (m) out.push({ kind: KIND[m[1]], sec: Math.round(parseFloat(m[2]) * 60) });
    }
  };
  expand(spec);
  return out;
}
export function describeSegments(segs) {
  const runs = segs.filter(s => s.kind === 'run');
  const total = segs.reduce((a, s) => a + s.sec, 0);
  const runSec = runs.reduce((a, s) => a + s.sec, 0);
  if (runs.length === 1) return `${fmtDurLong(runSec)} run, ${fmtDurLong(total)} total`;
  const uniq = [...new Set(runs.map(r => r.sec))];
  const runDesc = uniq.length === 1 ? `${runs.length} × ${fmtDurLong(runs[0].sec)} run` : `${runs.length} runs (${fmtDurLong(runSec)} running)`;
  return `${runDesc}, ${fmtDurLong(total)} total`;
}

export function planStartKey() {
  const s = getSettings();
  if (s.planStart) return s.planStart;
  if (s.raceDate) return dayKey(addDays(keyToDate(s.raceDate), -60));
  return null;
}
export function raceDayKey() {
  const s = getSettings();
  if (s.raceDate) return s.raceDate;
  const ps = planStartKey();
  return ps ? dayKey(addDays(keyToDate(ps), 60)) : null;
}
export function startPlanToday() {
  const start = dayKey(new Date());
  const s = getSettings();
  setSettings({ planStart: start, raceDate: s.raceDate || dayKey(addDays(new Date(), 60)) });
}

// Returns weeks with dated sessions and completion state.
export function getPlan() {
  const ps = planStartKey();
  const manual = lsGet('stride.plan', {});
  const today = dayKey(new Date());
  return WEEKS.map((w, wi) => ({
    n: wi + 1, focus: w.focus,
    sessions: w.sessions.map((spec, si) => {
      const key = `w${wi + 1}d${si + 1}`;
      const date = ps ? dayKey(addDays(keyToDate(ps), wi * 7 + DAY_OFFSETS[si])) : null;
      const segs = parseSegments(spec);
      const auto = date ? autoDone(date, segs) : null;
      const isRace = wi === WEEKS.length - 1 && si === 2;
      return {
        key, week: wi + 1, day: si + 1, spec, segs, date, isRace,
        name: isRace ? 'Race day: 5K' : `Session ${si + 1}`,
        desc: describeSegments(segs),
        done: manual[key] === true || (manual[key] !== false && !!auto),
        auto, today: date === today, past: date && date < today,
      };
    }),
  }));
}
function autoDone(date, segs) {
  const w = store.workouts.find(x => isRunLike(x) && dayKey(x.start) === date && (x.durationSec || 0) >= 600);
  return w ? w.id : null;
}
export function toggleSession(key, value) {
  const m = lsGet('stride.plan', {});
  m[key] = value;
  lsSet('stride.plan', m);
}
export function planSummary() {
  const plan = getPlan();
  const all = plan.flatMap(w => w.sessions);
  const done = all.filter(s => s.done).length;
  const today = dayKey(new Date());
  const next = all.find(s => !s.done && (!s.date || s.date >= today)) || all.find(s => !s.done);
  const todays = all.find(s => s.date === today);
  const overdue = all.filter(s => !s.done && s.date && s.date < today).length;
  return { total: all.length, done, next, todays, overdue, started: !!planStartKey() };
}
export function sessionByKey(key) { return getPlan().flatMap(w => w.sessions).find(s => s.key === key); }
export const PRESETS = [
  { key: 'easy20', name: 'Easy 20-minute run', spec: 'u5,r20,c5' },
  { key: 'easy30', name: 'Easy 30-minute run', spec: 'u5,r30,c5' },
  { key: 'rw1', name: 'Run 1 / walk 1.5 × 8', spec: 'u5,(r1,w1.5)x8,c5' },
  { key: 'rw3', name: 'Run 3 / walk 1 × 6', spec: 'u5,(r3,w1)x6,c5' },
  { key: 'free', name: 'Free run (no cues)', spec: '' },
];
