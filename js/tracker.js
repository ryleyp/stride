// Live GPS tracker and the run/walk interval coach.
import { haversine, uid } from './util.js';

// ---------------- GPS tracker ----------------
export const tracker = {
  state: 'idle',          // idle | running | paused | done
  type: 'Running',
  pts: [],                 // [lat, lon, ele, tSec, accuracy]
  distanceM: 0, elevGainM: 0, activeSec: 0,
  startedAt: null, lastResume: null, lastFix: null, accuracy: null, fixes: 0, rejected: 0,
  listeners: new Set(), _watch: null, _tick: null, _wake: null, _lastEle: null, error: null,
};
export function onTracker(fn) { tracker.listeners.add(fn); return () => tracker.listeners.delete(fn); }
function emit() { for (const fn of tracker.listeners) fn(tracker); }

export function elapsedSec() {
  let s = tracker.activeSec;
  if (tracker.state === 'running' && tracker.lastResume) s += (Date.now() - tracker.lastResume) / 1000;
  return s;
}
export function avgPaceSecPerKm() { const e = elapsedSec(); return tracker.distanceM > 50 ? e / (tracker.distanceM / 1000) : null; }
export function currentPaceSecPerKm() {
  // pace over roughly the last 30 seconds of fixes
  const pts = tracker.pts; if (pts.length < 3) return null;
  const tEnd = pts[pts.length - 1][3];
  let i = pts.length - 1, d = 0;
  while (i > 0 && tEnd - pts[i - 1][3] <= 30) { d += haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]); i--; }
  const dt = tEnd - pts[i][3];
  if (dt < 10 || d < 15) return null;
  return dt / (d / 1000);
}

function onFix(pos) {
  const c = pos.coords;
  tracker.fixes++;
  tracker.accuracy = c.accuracy;
  tracker.error = null;
  if (tracker.state !== 'running') { emit(); return; }
  if (c.accuracy > 40) { tracker.rejected++; emit(); return; }
  const t = Math.round(pos.timestamp / 1000);
  const p = [+c.latitude.toFixed(6), +c.longitude.toFixed(6), c.altitude != null ? +c.altitude.toFixed(1) : null, t, Math.round(c.accuracy)];
  const last = tracker.lastFix;
  if (last) {
    const d = haversine(last[0], last[1], p[0], p[1]);
    const dt = Math.max(1, t - last[3]);
    if (d / dt > 12) { tracker.rejected++; emit(); return; } // > 43 km/h: a GPS jump, not a runner
    if (d < Math.min(c.accuracy * 0.5, 8) && dt < 20) { emit(); return; } // standing still, do not accumulate jitter
    tracker.distanceM += d;
    if (p[2] != null && last[2] != null) {
      if (tracker._lastEle == null) tracker._lastEle = last[2];
      const de = p[2] - tracker._lastEle;
      if (de > 2) { tracker.elevGainM += de; tracker._lastEle = p[2]; } else if (de < -2) tracker._lastEle = p[2];
    }
  }
  tracker.pts.push(p);
  tracker.lastFix = p;
  emit();
}
function onErr(err) {
  tracker.error = err.code === 1 ? 'Location permission denied. Allow location for this site and try again.' : err.code === 2 ? 'No GPS fix yet. Head outside with a clear view of the sky.' : 'Location timed out. Still trying.';
  emit();
}
async function wakeLock() {
  try { if ('wakeLock' in navigator) tracker._wake = await navigator.wakeLock.request('screen'); } catch {}
}
export function startTracking(type = 'Running') {
  if (!('geolocation' in navigator)) { tracker.error = 'This browser has no location support.'; emit(); return; }
  Object.assign(tracker, { state: 'running', type, pts: [], distanceM: 0, elevGainM: 0, activeSec: 0, startedAt: Date.now(), lastResume: Date.now(), lastFix: null, fixes: 0, rejected: 0, _lastEle: null, error: null });
  tracker._watch = navigator.geolocation.watchPosition(onFix, onErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  tracker._tick = setInterval(emit, 1000);
  wakeLock();
  document.addEventListener('visibilitychange', onVis);
  emit();
}
function onVis() { if (document.visibilityState === 'visible' && tracker.state === 'running') wakeLock(); }
export function pauseTracking() {
  if (tracker.state !== 'running') return;
  tracker.activeSec += (Date.now() - tracker.lastResume) / 1000; tracker.lastResume = null;
  tracker.state = 'paused'; tracker.lastFix = null; emit();
}
export function resumeTracking() {
  if (tracker.state !== 'paused') return;
  tracker.state = 'running'; tracker.lastResume = Date.now(); emit();
}
export function stopTracking() {
  if (tracker.state === 'running') { tracker.activeSec += (Date.now() - tracker.lastResume) / 1000; tracker.lastResume = null; }
  if (tracker._watch != null) navigator.geolocation.clearWatch(tracker._watch);
  clearInterval(tracker._tick);
  try { tracker._wake?.release(); } catch {}
  document.removeEventListener('visibilitychange', onVis);
  tracker.state = 'done';
  emit();
  const start = new Date(tracker.startedAt);
  const id = 'stride:' + uid();
  const workout = {
    id, source: 'stride', device: 'Stride GPS', type: tracker.type, start: start.toISOString(), end: new Date().toISOString(),
    durationSec: Math.round(tracker.activeSec), distanceKm: tracker.distanceM / 1000, elevGainM: Math.round(tracker.elevGainM), indoor: false,
  };
  const route = tracker.pts.length > 1 ? { pts: tracker.pts.map(p => p.slice(0, 4)), distanceM: tracker.distanceM, elevGainM: tracker.elevGainM, durationSec: workout.durationSec, n: tracker.pts.length } : null;
  return { workout, route };
}
export function resetTracker() { Object.assign(tracker, { state: 'idle', pts: [], distanceM: 0, elevGainM: 0, activeSec: 0, startedAt: null, lastResume: null, lastFix: null, error: null, fixes: 0, rejected: 0 }); emit(); }

// ---------------- Interval coach ----------------
export const coach = {
  segs: [], idx: 0, segLeft: 0, state: 'idle', title: '', listeners: new Set(), _tick: null, _ctx: null, voice: true, _lastSec: null,
};
export function onCoach(fn) { coach.listeners.add(fn); return () => coach.listeners.delete(fn); }
function cemit() { for (const fn of coach.listeners) fn(coach); }
export function loadCoach(segs, title = '') { Object.assign(coach, { segs, idx: 0, segLeft: segs[0]?.sec || 0, state: 'idle', title }); cemit(); }
export function coachTotal() { return coach.segs.reduce((a, s) => a + s.sec, 0); }
export function coachElapsed() { return coach.segs.slice(0, coach.idx).reduce((a, s) => a + s.sec, 0) + ((coach.segs[coach.idx]?.sec || 0) - coach.segLeft); }

function beep(freq = 880, ms = 160, times = 1) {
  try {
    coach._ctx = coach._ctx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = coach._ctx;
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.25);
      g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + i * 0.25 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.25 + ms / 1000);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.25); o.stop(ctx.currentTime + i * 0.25 + ms / 1000 + 0.05);
    }
  } catch {}
}
function say(text) {
  if (!coach.voice || !('speechSynthesis' in window)) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; speechSynthesis.speak(u); } catch {}
}
function vibrate(p) { try { navigator.vibrate?.(p); } catch {} }
const LABEL = { warmup: 'Warm-up walk', run: 'Run', walk: 'Walk', cooldown: 'Cool-down walk' };
function announce(seg, next) {
  const mins = Math.round(seg.sec / 60 * 10) / 10;
  const dur = seg.sec % 60 === 0 ? `${seg.sec / 60} minute${seg.sec / 60 === 1 ? '' : 's'}` : `${mins} minutes`;
  if (seg.kind === 'run') { beep(988, 180, 2); vibrate([200, 100, 200]); say(`Run for ${dur}`); }
  else if (seg.kind === 'walk') { beep(660, 220, 1); vibrate([400]); say(`Walk for ${dur}`); }
  else { beep(660, 160, 1); say(`${LABEL[seg.kind]}, ${dur}`); }
  void next;
}
export function startCoach() {
  if (!coach.segs.length) return;
  if (coach.state === 'idle') { coach.idx = 0; coach.segLeft = coach.segs[0].sec; announce(coach.segs[0], coach.segs[1]); }
  coach.state = 'running';
  coach._lastSec = Date.now();
  clearInterval(coach._tick);
  coach._tick = setInterval(() => {
    const now = Date.now();
    const dt = Math.round((now - coach._lastSec) / 1000);
    if (dt < 1) return;
    coach._lastSec += dt * 1000;
    coach.segLeft -= dt;
    if (coach.segLeft <= 3 && coach.segLeft > 0 && coach.segs[coach.idx + 1]) beep(1200, 80, 1);
    while (coach.segLeft <= 0) {
      coach.idx++;
      if (coach.idx >= coach.segs.length) { finishCoach(); return; }
      coach.segLeft += coach.segs[coach.idx].sec;
      announce(coach.segs[coach.idx], coach.segs[coach.idx + 1]);
    }
    cemit();
  }, 250);
  cemit();
}
export function pauseCoach() { if (coach.state !== 'running') return; clearInterval(coach._tick); coach.state = 'paused'; cemit(); }
export function skipSegment() {
  if (coach.state === 'idle') return;
  coach.idx++;
  if (coach.idx >= coach.segs.length) { finishCoach(); return; }
  coach.segLeft = coach.segs[coach.idx].sec; announce(coach.segs[coach.idx], coach.segs[coach.idx + 1]); cemit();
}
function finishCoach() { clearInterval(coach._tick); coach.state = 'done'; coach.segLeft = 0; beep(988, 200, 3); vibrate([300, 100, 300, 100, 300]); say('Session complete. Nice work.'); cemit(); }
export function stopCoach() { clearInterval(coach._tick); coach.state = 'idle'; coach.idx = 0; coach.segLeft = coach.segs[0]?.sec || 0; try { speechSynthesis?.cancel(); } catch {} cemit(); }
export function primeAudio() { beep(1, 1, 1); try { speechSynthesis?.getVoices(); } catch {} }
