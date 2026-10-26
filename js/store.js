// In-memory app state backed by IndexedDB. Everything stays on this device.
import { dbGet, dbSet, dbDel, dbClear, dbGetAll, dbSetMany } from './db.js';
import { routeStats, dayKey, isRunLike } from './util.js';

export const store = {
  workouts: [],     // sorted newest first
  daily: {},        // 'YYYY-MM-DD' -> { steps, distKm, rhr, vo2, exmin }
  meta: { lastImport: null, demo: false },
  loaded: false,
  listeners: new Set(),
};

export function onChange(fn) { store.listeners.add(fn); return () => store.listeners.delete(fn); }
function emit() { for (const fn of store.listeners) { try { fn(); } catch (e) { console.error(e); } } }

export async function loadStore() {
  try {
    const [w, d, m] = await Promise.all([dbGet('kv', 'workouts'), dbGet('kv', 'daily'), dbGet('kv', 'meta')]);
    store.workouts = Array.isArray(w) ? w : [];
    store.daily = d && typeof d === 'object' ? d : {};
    store.meta = { lastImport: null, demo: false, ...(m || {}) };
  } catch (e) {
    console.warn('IndexedDB unavailable, running in memory only', e);
  }
  sortWorkouts();
  store.loaded = true;
  emit();
}

function sortWorkouts() { store.workouts.sort((a, b) => (a.start < b.start ? 1 : -1)); }

async function persist() {
  try {
    await dbSetMany('kv', [['workouts', store.workouts], ['daily', store.daily], ['meta', store.meta]]);
  } catch (e) { console.warn('persist failed', e); }
  emit();
}

// Merge an import result: { workouts: [], routes: {id: {pts}}, daily: {} }
export async function mergeImport(result, { demo = false } = {}) {
  const byId = new Map(store.workouts.map(w => [w.id, w]));
  for (const w of result.workouts) byId.set(w.id, { ...(byId.get(w.id) || {}), ...w });
  let list = [...byId.values()];
  list = dedupeWorkouts(list);
  store.workouts = list;
  sortWorkouts();
  for (const [day, v] of Object.entries(result.daily || {})) {
    store.daily[day] = { ...(store.daily[day] || {}), ...v };
  }
  if (result.routes && Object.keys(result.routes).length) {
    await dbSetMany('routes', Object.entries(result.routes));
  }
  store.meta.lastImport = new Date().toISOString();
  store.meta.demo = demo;
  await persist();
  return { workouts: result.workouts.length, days: Object.keys(result.daily || {}).length, routes: Object.keys(result.routes || {}).length };
}

// Apple Watch and iPhone can both log the same session. Keep the richer one.
function dedupeWorkouts(list) {
  const groups = new Map();
  for (const w of list) {
    const t = Math.round(new Date(w.start).getTime() / 120000); // 2-minute buckets
    const key = `${w.type}|${t}`;
    const cur = groups.get(key);
    if (!cur) { groups.set(key, w); continue; }
    const score = x => (x.routeId ? 10 : 0) + (x.avgHR ? 2 : 0) + (x.distanceKm || 0);
    groups.set(key, score(w) > score(cur) ? w : cur);
  }
  return [...groups.values()];
}

export async function addRecordedWorkout(workout, route) {
  if (route && route.pts && route.pts.length > 1) {
    const st = routeStats(route.pts);
    workout.routeId = workout.routeId || `route:${workout.id}`;
    if (!workout.distanceKm) workout.distanceKm = st.distanceM / 1000;
    if (workout.elevGainM == null) workout.elevGainM = st.elevGainM;
    await dbSet('routes', workout.routeId, route);
  }
  store.workouts.push(workout);
  sortWorkouts();
  await persist();
}

export async function deleteWorkout(id) {
  const w = store.workouts.find(x => x.id === id);
  store.workouts = store.workouts.filter(x => x.id !== id);
  if (w?.routeId) { try { await dbDel('routes', w.routeId); } catch {} }
  await persist();
}

export async function getRoute(routeId) {
  if (!routeId) return null;
  try { return await dbGet('routes', routeId); } catch { return null; }
}

export async function eraseAll() {
  store.workouts = []; store.daily = {}; store.meta = { lastImport: null, demo: false };
  try { await dbClear('kv'); await dbClear('routes'); } catch {}
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('stride.')) localStorage.removeItem(k);
  } catch {}
  emit();
}

export async function exportAll() {
  const routes = await dbGetAll('routes');
  return { version: 1, exportedAt: new Date().toISOString(), workouts: store.workouts, daily: store.daily, routes };
}

// ---------- derived data ----------
export function runs() { return store.workouts.filter(isRunLike); }
export function workoutsOn(day) { return store.workouts.filter(w => dayKey(w.start) === day); }
export function paceOf(w) { return w.distanceKm > 0 && w.durationSec > 0 ? w.durationSec / w.distanceKm : null; }
