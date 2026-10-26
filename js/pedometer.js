// Live pedometer from the phone's motion sensor. Counts only while the page is open and the screen is on.
// Algorithm: magnitude of acceleration, gravity removed with a slow low-pass, then peak detection with
// a minimum step interval. Counts persist per day in localStorage so a reload doesn't lose them.
import { lsGet, lsSet, dayKey } from './util.js';

const KEY = 'stride.pedo';
export const pedometer = {
  running: false, steps: 0, cadence: 0, listeners: new Set(), supported: typeof DeviceMotionEvent !== 'undefined',
  _gravity: 9.81, _smooth: 0, _lastStep: 0, _above: false, _stepTimes: [], _saveT: 0, _permission: 'unknown',
};

export function todayCount() { const m = lsGet(KEY, {}); return m[dayKey(new Date())] || 0; }
export function allCounts() { return lsGet(KEY, {}); }
function save() {
  const m = lsGet(KEY, {});
  m[dayKey(new Date())] = pedometer.steps;
  lsSet(KEY, m);
}
export function onPedometer(fn) { pedometer.listeners.add(fn); return () => pedometer.listeners.delete(fn); }
function emit() { for (const fn of pedometer.listeners) fn(pedometer); }

function onMotion(ev) {
  const a = ev.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
  // slow low-pass tracks gravity (and any constant offset); fast one smooths jitter
  pedometer._gravity = pedometer._gravity * 0.97 + mag * 0.03;
  const dyn = mag - pedometer._gravity;
  pedometer._smooth = pedometer._smooth * 0.6 + dyn * 0.4;
  const now = performance.now();
  const TH = 1.15; // m/s^2 above gravity; walking peaks are ~1.5-3, running higher
  if (!pedometer._above && pedometer._smooth > TH) {
    pedometer._above = true;
    const dt = now - pedometer._lastStep;
    if (dt > 250 && dt < 2000) {
      pedometer.steps++;
      pedometer._stepTimes.push(now);
      if (pedometer._stepTimes.length > 40) pedometer._stepTimes.shift();
    } else if (dt >= 2000) {
      pedometer.steps++;
      pedometer._stepTimes = [now];
    }
    pedometer._lastStep = now;
    const recent = pedometer._stepTimes.filter(t => now - t < 10000);
    pedometer.cadence = recent.length >= 3 ? Math.round((recent.length - 1) / ((now - recent[0]) / 60000)) : 0;
    if (now - pedometer._saveT > 2000) { save(); pedometer._saveT = now; }
    emit();
  } else if (pedometer._above && pedometer._smooth < TH * 0.4) {
    pedometer._above = false;
  }
}

export async function startPedometer() {
  if (!pedometer.supported) throw new Error('This device has no motion sensor the browser can read.');
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    let res;
    try { res = await DeviceMotionEvent.requestPermission(); } catch (e) { throw new Error('Motion permission was not granted. Open Settings › Safari › Motion & Orientation Access, or tap Start again.'); }
    if (res !== 'granted') throw new Error('Motion permission denied. You can allow it in Settings › Safari › Motion & Orientation Access.');
  }
  pedometer.steps = todayCount();
  pedometer._day = dayKey(new Date());
  window.addEventListener('devicemotion', onMotion);
  pedometer.running = true;
  pedometer._tick = setInterval(() => {
    // roll over at midnight and keep the cadence readout honest when standing still
    const d = dayKey(new Date());
    if (d !== pedometer._day) { save(); pedometer._day = d; pedometer.steps = 0; pedometer._stepTimes = []; }
    if (performance.now() - pedometer._lastStep > 10000) pedometer.cadence = 0;
    emit();
  }, 1000);
  emit();
}
export function stopPedometer() {
  window.removeEventListener('devicemotion', onMotion);
  clearInterval(pedometer._tick);
  pedometer.running = false;
  save(); emit();
}
export function resetToday() {
  pedometer.steps = 0; pedometer._stepTimes = []; pedometer.cadence = 0; save(); emit();
}
