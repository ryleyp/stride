// Shared helpers: units, formatting, dates, geometry, settings.
export const KM_PER_MI = 1.609344;

const DEFAULTS = {
  units: 'mi',          // 'mi' | 'km'
  raceDate: '',         // 'YYYY-MM-DD'
  goalTimeSec: 1800,    // 30:00 goal
  planStart: '',        // Monday 'YYYY-MM-DD'
  stepGoal: 8000,
  strideM: 0.75,        // meters per step, used for the live pedometer distance estimate
  age: '',
  maxHR: '',
  demo: false,
};

export function getSettings() {
  try {
    const raw = localStorage.getItem('stride.settings');
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch { return { ...DEFAULTS }; }
}
export function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  try { localStorage.setItem('stride.settings', JSON.stringify(next)); } catch {}
  return next;
}
export function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ---------- formatting ----------
export function distUnit(units) { return units === 'km' ? 'km' : 'mi'; }
export function kmToUnit(km, units) { return units === 'km' ? km : km / KM_PER_MI; }
export function fmtDist(km, units, digits = 2) {
  if (km == null || isNaN(km)) return '–';
  return kmToUnit(km, units).toFixed(digits);
}
export function fmtDistU(km, units, digits = 2) { return `${fmtDist(km, units, digits)} ${distUnit(units)}`; }
export function paceSecPerUnit(secPerKm, units) { return units === 'km' ? secPerKm : secPerKm * KM_PER_MI; }
export function fmtPace(secPerKm, units) {
  if (!secPerKm || !isFinite(secPerKm) || secPerKm <= 0) return '–';
  const s = Math.round(paceSecPerUnit(secPerKm, units));
  if (s > 3600) return '–';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function fmtPaceU(secPerKm, units) { const p = fmtPace(secPerKm, units); return p === '–' ? p : `${p} /${distUnit(units)}`; }
export function fmtDur(sec) {
  if (sec == null || isNaN(sec)) return '–';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export function fmtDurLong(sec) {
  if (sec == null || isNaN(sec)) return '–';
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} hr ${m % 60} min`;
}
export function fmtInt(n) { return n == null || isNaN(n) ? '–' : Math.round(n).toLocaleString(); }
export function fmtElev(m, units) {
  if (m == null || isNaN(m)) return '–';
  return units === 'km' ? `${Math.round(m)} m` : `${Math.round(m * 3.28084)} ft`;
}
export function fmtDate(d, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return toDate(d).toLocaleDateString(undefined, opts);
}
export function fmtTime(d) { return toDate(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
export function relDay(key) {
  const today = dayKey(new Date());
  if (key === today) return 'Today';
  if (key === dayKey(addDays(new Date(), -1))) return 'Yesterday';
  return fmtDate(keyToDate(key));
}

// ---------- dates ----------
export function toDate(d) { return d instanceof Date ? d : new Date(d); }
export function pad2(n) { return String(n).padStart(2, '0'); }
export function dayKey(d) {
  d = toDate(d);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function keyToDate(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(d, n) { const x = new Date(toDate(d)); x.setDate(x.getDate() + n); return x; }
export function daysBetween(a, b) { return Math.round((keyToDate(dayKey(b)) - keyToDate(dayKey(a))) / 86400000); }
export function startOfWeek(d) { // Monday
  const x = keyToDate(dayKey(d));
  const dow = (x.getDay() + 6) % 7;
  return addDays(x, -dow);
}
export function weekKey(d) { return dayKey(startOfWeek(d)); }
// Apple export dates look like "2026-10-20 07:15:00 -0500"
export function appleDateToIso(s) {
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/);
  if (!m) return new Date(s).toISOString();
  return `${m[1]}T${m[2]}${m[3]}:${m[4]}`;
}

// ---------- geometry ----------
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
// pts: [[lat, lon, ele|null, tSec|null], ...]
export function routeStats(pts) {
  let dist = 0, gain = 0, lastEle = null;
  for (let i = 1; i < pts.length; i++) {
    dist += haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  }
  // elevation gain with light smoothing: moving average over 5 samples, count rises > 1 m
  const eles = pts.map(p => p[2]).filter(e => e != null && !isNaN(e));
  if (eles.length > 5) {
    const sm = [];
    for (let i = 0; i < eles.length; i++) {
      const a = Math.max(0, i - 2), b = Math.min(eles.length, i + 3);
      let s = 0; for (let j = a; j < b; j++) s += eles[j];
      sm.push(s / (b - a));
    }
    for (const e of sm) { if (lastEle != null && e - lastEle > 0) gain += e - lastEle; lastEle = e; }
  }
  const t0 = pts.find(p => p[3])?.[3], t1 = [...pts].reverse().find(p => p[3])?.[3];
  return { distanceM: dist, elevGainM: gain, durationSec: t0 && t1 ? t1 - t0 : null };
}
export function downsample(pts, max = 1200) {
  if (pts.length <= max) return pts;
  const step = pts.length / max, out = [];
  for (let i = 0; i < pts.length; i += step) out.push(pts[Math.floor(i)]);
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}
// Per-split times from a timestamped route. Returns [{n, distKm, sec, paceSecPerKm}]
export function computeSplits(pts, splitKm) {
  const out = [];
  let acc = 0, segStartT = null, segStartDist = 0, lastT = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p[3] == null) continue;
    if (segStartT == null) { segStartT = p[3]; }
    if (i > 0) acc += haversine(pts[i - 1][0], pts[i - 1][1], p[0], p[1]) / 1000;
    lastT = p[3];
    while (acc - segStartDist >= splitKm) {
      // interpolate the time at which the split boundary was crossed
      const prevAcc = acc - haversine(pts[i - 1][0], pts[i - 1][1], p[0], p[1]) / 1000;
      const prevT = pts[i - 1][3] ?? p[3];
      const frac = prevAcc === acc ? 1 : ((segStartDist + splitKm) - prevAcc) / (acc - prevAcc);
      const tCross = prevT + (p[3] - prevT) * Math.min(1, Math.max(0, frac));
      const sec = tCross - segStartT;
      out.push({ n: out.length + 1, distKm: splitKm, sec, paceSecPerKm: sec / splitKm });
      segStartDist += splitKm; segStartT = tCross;
    }
  }
  const rem = acc - segStartDist;
  if (rem > 0.05 && segStartT != null && lastT != null) {
    const sec = lastT - segStartT;
    out.push({ n: out.length + 1, distKm: rem, sec, paceSecPerKm: sec / rem, partial: true });
  }
  return out;
}

// ---------- training math ----------
// Riegel prediction: time for distance d2 given time t1 at distance d1.
export function riegel(t1, d1, d2) { return t1 * Math.pow(d2 / d1, 1.06); }
export function hrZones(maxHR) {
  const z = [[0.5, 0.6, 'Z1 Easy'], [0.6, 0.7, 'Z2 Aerobic'], [0.7, 0.8, 'Z3 Tempo'], [0.8, 0.9, 'Z4 Threshold'], [0.9, 1.01, 'Z5 Max']];
  return z.map(([a, b, name]) => ({ name, lo: Math.round(maxHR * a), hi: Math.round(maxHR * b) }));
}
export function zoneFor(hr, maxHR) {
  if (!hr || !maxHR) return null;
  const r = hr / maxHR;
  if (r < 0.6) return 'Z1 Easy'; if (r < 0.7) return 'Z2 Aerobic'; if (r < 0.8) return 'Z3 Tempo'; if (r < 0.9) return 'Z4 Threshold'; return 'Z5 Max';
}

// ---------- DOM ----------
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
export function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
export function humanType(t) {
  if (!t) return 'Workout';
  const map = { TraditionalStrengthTraining: 'Strength', FunctionalStrengthTraining: 'Strength', HighIntensityIntervalTraining: 'HIIT', MixedCardio: 'Mixed cardio', CoreTraining: 'Core', Cooldown: 'Cooldown', MindAndBody: 'Mind and body', StairClimbing: 'Stairs', Other: 'Other' };
  if (map[t]) return map[t];
  return t.replace(/([a-z])([A-Z])/g, '$1 $2');
}
export function isRunLike(w) { return w.type === 'Running' || w.type === 'Walking' || w.type === 'Hiking'; }
export function yieldToUI() { return new Promise(r => setTimeout(r, 0)); }
