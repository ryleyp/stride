// Stride: router and views.
import { store, loadStore, onChange, mergeImport, addRecordedWorkout, deleteWorkout, getRoute, eraseAll, exportAll, runs, paceOf } from './store.js';
import { importFiles, toGpx } from './health-import.js';
import { barChart, lineChart, sparkline } from './charts.js';
import { getPlan, planSummary, toggleSession, sessionByKey, startPlanToday, raceDayKey, planStartKey, PRESETS, parseSegments, describeSegments } from './plan.js';
import { pedometer, startPedometer, stopPedometer, resetToday, todayCount, onPedometer } from './pedometer.js';
import { tracker, onTracker, startTracking, pauseTracking, resumeTracking, stopTracking, resetTracker, elapsedSec, avgPaceSecPerKm, currentPaceSecPerKm, coach, onCoach, loadCoach, startCoach, pauseCoach, stopCoach, skipSegment, coachTotal, coachElapsed, primeAudio } from './tracker.js';
import { getSettings, setSettings, lsGet, lsSet, fmtDist, fmtDistU, distUnit, fmtPace, fmtPaceU, paceSecPerUnit, fmtDur, fmtDurLong, fmtInt, fmtElev, fmtDate, fmtTime, relDay, dayKey, keyToDate, addDays, daysBetween, startOfWeek, weekKey, riegel, hrZones, zoneFor, esc, toast, humanType, isRunLike, kmToUnit, KM_PER_MI, computeSplits } from './util.js';

const view = document.getElementById('view');
let cleanup = null;
let current = '';

// ---------- helpers ----------
const S = () => getSettings();
function icon(type) {
  const t = type || '';
  if (t === 'Running') return '<svg viewBox="0 0 24 24"><path d="M4 18h3l2-5 3 2v5h2v-6l-3-2.5 1-3 2 2h4V8.5h-3l-2.5-2.6a2 2 0 0 0-2.3-.4L6.5 7.7 5 11.5h2l1-2.3 1.7-.8L8 12.5l-4 5.5Z"/><circle cx="15.5" cy="4" r="2"/></svg>';
  if (t === 'Walking' || t === 'Hiking') return '<svg viewBox="0 0 24 24"><path d="M13.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM9.8 8.9 7 22h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7Z"/></svg>';
  if (t === 'Cycling') return '<svg viewBox="0 0 24 24"><path d="M5 20.5A3.5 3.5 0 0 1 1.5 17 3.5 3.5 0 0 1 5 13.5 3.5 3.5 0 0 1 8.5 17 3.5 3.5 0 0 1 5 20.5Zm0-5a1.5 1.5 0 0 0 0 3 1.5 1.5 0 0 0 0-3Zm14 5a3.5 3.5 0 0 1-3.5-3.5 3.5 3.5 0 0 1 3.5-3.5 3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5Zm0-5a1.5 1.5 0 0 0 0 3 1.5 1.5 0 0 0 0-3ZM10 17H8l3-6-2-2-1.9 1.9L5.7 9.5 8.3 7c.4-.4 1-.5 1.5-.1l2.7 2.6h3.5v2h-4.3L10 10l1.9 1.9L10 17Zm5-13a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/></svg>';
  return '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z"/></svg>';
}
function download(filename, text, mime = 'application/octet-stream') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}
function makeMap(el, opts = {}) {
  if (!window.L) return null;
  const map = L.map(el, { zoomControl: false, attributionControl: true, ...opts });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  return map;
}
function lineStyle() { return { color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2a78d6', weight: 4, opacity: 0.95, lineJoin: 'round' }; }
function predict5k() {
  // Best measured 5K (any run that covered 5 km) or a Riegel projection from the best recent effort.
  const now = Date.now();
  const rs = runs().filter(w => w.type === 'Running' && w.distanceKm > 0 && w.durationSec > 0 && now - new Date(w.start) < 120 * 86400000);
  let best = null;
  for (const w of rs) {
    const t = w.distanceKm >= 5 ? w.durationSec * (5 / w.distanceKm) : w.distanceKm >= 1.5 ? riegel(w.durationSec, w.distanceKm, 5) : null;
    if (t && (!best || t < best.t)) best = { t, w, measured: w.distanceKm >= 5 };
  }
  return best;
}
function weekTotals(n = 12) {
  const out = [];
  const thisMon = startOfWeek(new Date());
  for (let i = n - 1; i >= 0; i--) {
    const mon = addDays(thisMon, -7 * i), key = dayKey(mon);
    const ws = runs().filter(w => weekKey(w.start) === key);
    out.push({ key, mon, km: ws.reduce((a, w) => a + (w.distanceKm || 0), 0), count: ws.length, sec: ws.reduce((a, w) => a + (w.durationSec || 0), 0) });
  }
  return out;
}
function latestDaily(field, days = 60) {
  const keys = Object.keys(store.daily).filter(k => store.daily[k][field] != null).sort();
  const cutoff = dayKey(addDays(new Date(), -days));
  return keys.filter(k => k >= cutoff).map(k => ({ day: k, v: store.daily[k][field] }));
}
function hasData() { return store.workouts.length > 0 || Object.keys(store.daily).length > 0; }
function raceChip() {
  const chip = document.getElementById('race-chip');
  const rd = raceDayKey();
  if (!rd) { chip.hidden = true; return; }
  const d = daysBetween(new Date(), keyToDate(rd));
  chip.textContent = d > 1 ? `${d} days to race` : d === 1 ? 'Race tomorrow' : d === 0 ? 'Race day!' : `Raced ${-d}d ago`;
  chip.hidden = false;
}
function workoutRow(w) {
  const u = S().units;
  const pace = paceOf(w);
  const sub = `${relDay(dayKey(w.start))} · ${fmtTime(w.start)} · ${esc(w.device || '')}${w.indoor ? ' · Indoor' : ''}`;
  return `<a class="row" href="#run/${encodeURIComponent(w.id)}">
    <span class="ico">${icon(w.type)}</span>
    <span><span class="t">${esc(humanType(w.type))}${w.source === 'stride' ? ' <span class="pill stride">Stride</span>' : ''}</span><br><span class="s">${sub}</span></span>
    <span class="r"><span class="big">${w.distanceKm ? fmtDist(w.distanceKm, u) : fmtDur(w.durationSec)}</span><span class="s">${w.distanceKm ? `${distUnit(u)} · ${fmtDur(w.durationSec)}${pace ? ' · ' + fmtPace(pace, u) : ''}` : 'no distance'}</span></span>
  </a>`;
}

// ---------- Home ----------
function renderHome() {
  const u = S().units, s = S();
  const today = dayKey(new Date());
  if (!hasData()) {
    view.innerHTML = `
      <section class="hero">
        <span class="eyebrow">Stride</span>
        <h1 style="font-size:2rem">Everything for your 5K, in one place.</h1>
        <p>Bring in your Apple Watch and iPhone workouts, track runs live with GPS, count steps, and follow a 9-week run/walk plan. All of it stays on this device.</p>
        <div class="btn-row"><a class="btn" href="#settings">Import Apple Health</a><button class="btn secondary" id="demo-btn">Try with demo data</button></div>
      </section>
      <section class="card empty">
        <h2>How to get your Apple workouts in</h2>
        <ol class="steps-list">
          <li>On your iPhone open <b>Health</b>, tap your picture, then <b>Export All Health Data</b>.</li>
          <li>Save <b>export.zip</b> to Files (it can take a few minutes to build).</li>
          <li>Open Stride, go to Settings, and choose that zip. Workouts, routes, steps, resting heart rate and VO2 max come in.</li>
        </ol>
        <p class="small muted">Big exports? On a Mac, <code>tools/convert_export.py</code> shrinks the zip to a small health.json that imports instantly.</p>
      </section>
      <section class="card">
        <h2>Or start right now</h2>
        <p class="muted small">Track a run with GPS and voice-cued run/walk intervals, or set your race day and begin the plan.</p>
        <div class="btn-row" style="margin-top:10px"><a class="btn secondary" href="#track">Track a run</a><a class="btn secondary" href="#plan">See the plan</a></div>
      </section>`;
    view.querySelector('#demo-btn').addEventListener('click', loadDemo);
    return;
  }
  const rd = raceDayKey();
  const pred = predict5k();
  const weeks = weekTotals(12);
  const thisW = weeks[weeks.length - 1], lastW = weeks[weeks.length - 2];
  const delta = lastW.km > 0 ? ((thisW.km - lastW.km) / lastW.km) * 100 : null;
  const longest = runs().reduce((a, w) => (w.distanceKm || 0) > (a?.distanceKm || 0) ? w : a, null);
  const sum = planSummary();
  const vo2 = latestDaily('vo2', 180), rhr = latestDaily('rhr', 30);
  const stepsHist = latestDaily('steps', 7);
  const todaySteps = Math.max(store.daily[today]?.steps || 0, todayCount());
  const daysTo = rd ? daysBetween(new Date(), keyToDate(rd)) : null;
  const goalPace = s.goalTimeSec / 5;

  view.innerHTML = `
    ${store.meta.demo ? '<div class="notice warn"><b>Demo data</b> is loaded. Import your real Apple Health export from Settings to replace it.</div>' : ''}
    <section class="hero">
      ${rd ? `<span class="eyebrow">${daysTo >= 0 ? 'Race day' : 'Race was'} · ${fmtDate(keyToDate(rd), { weekday: 'long', month: 'long', day: 'numeric' })}</span>
      <div class="hero-num">${daysTo > 0 ? `${daysTo}<small>days to go</small>` : daysTo === 0 ? 'Today' : `${-daysTo}<small>days ago</small>`}</div>`
      : `<span class="eyebrow">No race date yet</span><div class="hero-num" style="font-size:2rem">Pick your 5K date</div>`}
      <div class="hero-row">
        <div class="hero-stat"><div class="eyebrow">Predicted 5K</div><div class="v">${pred ? fmtDur(pred.t) : '–'}</div></div>
        <div class="hero-stat"><div class="eyebrow">Goal</div><div class="v">${fmtDur(s.goalTimeSec)}</div></div>
        <div class="hero-stat"><div class="eyebrow">Goal pace</div><div class="v">${fmtPaceU(goalPace, u)}</div></div>
      </div>
      ${pred ? `<p class="small" style="opacity:.85">${pred.measured ? `Your fastest 5K distance so far, ${fmtDate(pred.w.start)}.` : `Projected from your ${fmtDistU(pred.w.distanceKm, u)} run on ${fmtDate(pred.w.start)} (Riegel formula). Longer runs make this sharper.`}</p>` : '<p class="small" style="opacity:.85">Run at least 1.5 km with distance recorded and Stride will project your 5K time.</p>'}
      ${!rd ? '<div class="btn-row"><a class="btn" href="#settings">Set race day</a></div>' : ''}
    </section>

    ${sum.started && (sum.todays || sum.next) ? (() => {
      const ss = sum.todays || sum.next;
      return `<section class="card">
        <div class="card-head"><h2>${sum.todays ? "Today's session" : 'Next session'}</h2><span class="sub">Week ${ss.week} · ${ss.date ? fmtDate(keyToDate(ss.date)) : ''}</span></div>
        <p><b>${esc(ss.name)}</b> · ${esc(ss.desc)}</p>
        <div class="btn-row" style="margin-top:12px">
          ${ss.done ? '<span class="chip chip-race">Done ✓</span>' : `<a class="btn" href="#track/${ss.key}">Start with coach</a>`}
          <a class="btn ghost" href="#plan">View plan</a>
        </div>
      </section>`;
    })() : `<section class="card"><div class="card-head"><h2>Training plan</h2></div><p class="muted">A 9-week run/walk plan that ends on race day. Three sessions a week, about 30 minutes each.</p><div class="btn-row" style="margin-top:12px"><button class="btn" id="start-plan">Start the plan today</button><a class="btn ghost" href="#plan">Preview</a></div></section>`}

    <section class="tiles">
      <div class="tile"><span class="label">This week</span><span class="value">${fmtDist(thisW.km, u)}<small>${distUnit(u)}</small></span><span class="delta ${delta == null || thisW.km === 0 ? '' : delta >= 0 ? 'up' : 'down'}">${thisW.km === 0 ? `nothing yet · ${fmtDist(lastW.km, u)} last week` : delta == null ? `${thisW.count} run${thisW.count === 1 ? '' : 's'}` : `${delta >= 0 ? '+' : ''}${Math.round(delta)}% vs last week`}</span></div>
      <div class="tile"><span class="label">Runs this week</span><span class="value">${thisW.count}</span><span class="delta">${fmtDurLong(thisW.sec)} moving</span></div>
      <div class="tile"><span class="label">Longest run</span><span class="value">${longest ? fmtDist(longest.distanceKm, u) : '–'}<small>${distUnit(u)}</small></span><span class="delta">${longest ? fmtDate(longest.start) : ''}</span></div>
      <div class="tile"><span class="label">Steps today</span><span class="value">${fmtInt(todaySteps)}</span><span class="delta">${stepsHist.length ? `7-day avg ${fmtInt(stepsHist.reduce((a, x) => a + x.v, 0) / stepsHist.length)}` : 'goal ' + fmtInt(s.stepGoal)}</span></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Weekly distance</h2><span class="sub">last 12 weeks, ${distUnit(u)}</span></div>
      <div id="chart-weeks"></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Recent activity</h2><a class="small" href="#runs">All runs</a></div>
      <div class="list">${store.workouts.slice(0, 4).map(workoutRow).join('') || '<p class="muted">No workouts yet.</p>'}</div>
    </section>

    ${(vo2.length || rhr.length) ? `<section class="tiles">
      ${vo2.length ? `<div class="tile"><span class="label">VO2 max</span><span class="value">${vo2[vo2.length - 1].v.toFixed(1)}<small>mL/kg/min</small></span><span class="delta">${sparkline(vo2.slice(-12).map(x => x.v))}</span></div>` : ''}
      ${rhr.length ? `<div class="tile"><span class="label">Resting heart rate</span><span class="value">${Math.round(rhr[rhr.length - 1].v)}<small>bpm</small></span><span class="delta">${sparkline(rhr.slice(-14).map(x => x.v))}</span></div>` : ''}
    </section>` : ''}

    <section class="card">
      <div class="card-head"><h2>Pace trend</h2><span class="sub">runs over 1 km, last 90 days</span></div>
      <div id="chart-pace"></div>
      <p class="small muted" style="margin-top:8px">Dashed line is your goal pace. Lower is faster.</p>
    </section>`;

  view.querySelector('#start-plan')?.addEventListener('click', () => { startPlanToday(); toast('Plan started. Race day set 60 days out.'); renderHome(); raceChip(); });

  barChart(view.querySelector('#chart-weeks'), {
    data: weeks.map((w, i) => ({ label: w.mon.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), value: +kmToUnit(w.km, u).toFixed(2), hl: i === weeks.length - 1, w })),
    yFormat: v => v.toFixed(v >= 10 ? 0 : 1),
    tipFormat: d => `<b>${fmtDistU(d.w.km, u)}</b> · ${d.w.count} run${d.w.count === 1 ? '' : 's'} · week of ${d.label}`,
  });
  const paceRuns = runs().filter(w => w.type === 'Running' && w.distanceKm >= 1 && w.durationSec > 0 && Date.now() - new Date(w.start) < 90 * 86400000).sort((a, b) => a.start < b.start ? -1 : 1);
  const paceEl = view.querySelector('#chart-pace');
  if (paceRuns.length >= 2) {
    lineChart(paceEl, {
      data: paceRuns.map(w => ({ x: new Date(w.start), y: paceSecPerUnit(paceOf(w), u) / 60, w })),
      yFormat: v => { const sec = Math.round(v * 60); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; },
      goal: paceSecPerUnit(goalPace, u) / 60, goalLabel: 'goal pace',
      tipFormat: d => `<b>${fmtPaceU(paceOf(d.w), u)}</b> · ${fmtDistU(d.w.distanceKm, u)} · ${fmtDate(d.w.start)}`,
    });
  } else paceEl.innerHTML = '<p class="muted small">Two or more runs with distance are needed to draw a trend.</p>';
}

async function loadDemo() {
  try {
    toast('Loading demo data…');
    const res = await fetch('sample/demo.json');
    const json = await res.json();
    if (hasData()) await eraseAll();
    await mergeImport(json, { demo: true });
    if (!S().raceDate) setSettings({ raceDate: dayKey(addDays(new Date(), 18)), planStart: dayKey(addDays(new Date(), -42)) });
    toast('Demo data loaded. This is not your data.');
    raceChip(); navigate();
  } catch (e) { console.error(e); toast('Could not load demo data: ' + e.message); }
}

// ---------- Runs ----------
function renderRuns() {
  const filter = lsGet('stride.runFilter', 'all');
  const filters = [['all', 'All'], ['Running', 'Runs'], ['Walking', 'Walks'], ['Hiking', 'Hikes'], ['other', 'Other']];
  const list = store.workouts.filter(w => filter === 'all' ? true : filter === 'other' ? !isRunLike(w) : w.type === filter);
  const u = S().units;
  const total = list.reduce((a, w) => a + (w.distanceKm || 0), 0);
  view.innerHTML = `
    <div class="section-title"><h1>Workouts</h1><span class="muted small">${list.length} · ${fmtDistU(total, u)}</span></div>
    <div class="chips">${filters.map(([k, n]) => `<button data-f="${k}" class="${filter === k ? 'active' : ''}">${n}</button>`).join('')}</div>
    <section class="card"><div class="list">${list.length ? list.slice(0, 200).map(workoutRow).join('') : '<p class="muted">Nothing here yet. Import your Apple Health export or track a run.</p>'}</div>${list.length > 200 ? '<p class="small muted">Showing the latest 200.</p>' : ''}</section>`;
  view.querySelectorAll('.chips button').forEach(b => b.addEventListener('click', () => { lsSet('stride.runFilter', b.dataset.f); renderRuns(); }));
}

async function renderRun(id) {
  const w = store.workouts.find(x => x.id === id);
  if (!w) { view.innerHTML = '<p class="muted">That workout is gone.</p><a class="btn secondary" href="#runs">Back</a>'; return; }
  const u = S().units, s = S();
  const route = await getRoute(w.routeId);
  const pace = paceOf(w);
  const maxHR = s.maxHR ? +s.maxHR : s.age ? 220 - +s.age : null;
  const pred = w.type === 'Running' && w.distanceKm >= 1.5 && w.durationSec ? (w.distanceKm >= 5 ? w.durationSec * 5 / w.distanceKm : riegel(w.durationSec, w.distanceKm, 5)) : null;
  const splitKm = u === 'km' ? 1 : KM_PER_MI;
  const splits = route && route.pts.some(p => p[3]) ? computeSplits(route.pts, splitKm) : [];
  view.innerHTML = `
    <a class="small" href="#runs">← Workouts</a>
    <div class="section-title"><h1>${esc(humanType(w.type))}</h1><span class="pill ${w.source}">${w.source === 'stride' ? 'Stride' : esc(w.device || 'Apple')}</span></div>
    <p class="muted">${fmtDate(w.start, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} at ${fmtTime(w.start)}${w.indoor ? ' · Indoor' : ''}</p>
    ${route ? '<div id="map" class="map"></div>' : `<div class="notice">${w.indoor ? 'Indoor workout, so there is no route.' : 'No GPS route came with this workout.'}</div>`}
    <section class="tiles">
      <div class="tile"><span class="label">Distance</span><span class="value">${w.distanceKm ? fmtDist(w.distanceKm, u) : '–'}<small>${distUnit(u)}</small></span></div>
      <div class="tile"><span class="label">Time</span><span class="value">${fmtDur(w.durationSec)}</span></div>
      <div class="tile"><span class="label">Avg pace</span><span class="value">${fmtPace(pace, u)}<small>/${distUnit(u)}</small></span></div>
      ${w.avgHR ? `<div class="tile"><span class="label">Avg heart rate</span><span class="value">${w.avgHR}<small>bpm</small></span><span class="delta">${maxHR ? zoneFor(w.avgHR, maxHR) : `max ${w.maxHR || '–'}`}</span></div>` : ''}
    </section>
    <section class="card">
      <dl class="detail-list">
        ${w.kcal ? `<dt>Active calories</dt><dd>${fmtInt(w.kcal)} kcal</dd>` : ''}
        ${w.elevGainM != null ? `<dt>Elevation gain</dt><dd>${fmtElev(w.elevGainM, u)}</dd>` : ''}
        ${w.maxHR ? `<dt>Max heart rate</dt><dd>${w.maxHR} bpm</dd>` : ''}
        ${w.tempC != null ? `<dt>Temperature</dt><dd>${Math.round(w.tempC * 9 / 5 + 32)}°F</dd>` : ''}
        ${pred ? `<dt>5K at this effort</dt><dd>${fmtDur(pred)}</dd>` : ''}
        <dt>Recorded by</dt><dd>${esc(w.device || '')}</dd>
      </dl>
    </section>
    ${splits.length ? `<section class="card"><div class="card-head"><h2>Splits</h2><span class="sub">per ${distUnit(u)}, from the GPS route</span></div><div class="table-wrap"><table class="splits"><thead><tr><th>${distUnit(u)}</th><th>Time</th><th>Pace</th></tr></thead><tbody>
      ${splits.map(sp => `<tr><td>${sp.partial ? fmtDist(sp.distKm, u) : sp.n}</td><td>${fmtDur(sp.sec)}</td><td>${fmtPace(sp.paceSecPerKm, u)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
    <div class="btn-row">
      ${route ? '<button class="btn secondary" id="gpx">Export GPX</button>' : ''}
      ${w.source === 'stride' ? '<button class="btn danger" id="del">Delete</button>' : ''}
    </div>`;
  if (route) {
    const map = makeMap(view.querySelector('#map'));
    if (map) {
      const latlngs = route.pts.map(p => [p[0], p[1]]);
      const line = L.polyline(latlngs, lineStyle()).addTo(map);
      L.circleMarker(latlngs[0], { radius: 6, color: '#fff', weight: 2, fillColor: '#0ca30c', fillOpacity: 1 }).addTo(map);
      L.circleMarker(latlngs[latlngs.length - 1], { radius: 6, color: '#fff', weight: 2, fillColor: '#d03b3b', fillOpacity: 1 }).addTo(map);
      map.fitBounds(line.getBounds(), { padding: [20, 20] });
      cleanup = () => map.remove();
    }
  }
  view.querySelector('#gpx')?.addEventListener('click', () => download(`stride-${dayKey(w.start)}-${w.type.toLowerCase()}.gpx`, toGpx(w, route), 'application/gpx+xml'));
  view.querySelector('#del')?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget;
    if (b.dataset.armed) { await deleteWorkout(w.id); toast('Workout deleted'); location.hash = '#runs'; return; }
    b.dataset.armed = '1'; b.textContent = 'Tap again to delete';
  });
}

// ---------- Track ----------
let map, line, marker;
function renderTrack(arg) {
  const u = S().units;
  let sessionKey = null, title = 'Free run', segs = [];
  const sum = planSummary();
  if (arg) {
    const ss = sessionByKey(arg);
    if (ss) { sessionKey = ss.key; title = `Week ${ss.week} · ${ss.name}`; segs = ss.segs; }
    else { const p = PRESETS.find(x => x.key === arg); if (p) { title = p.name; segs = parseSegments(p.spec); } }
  } else if (sum.todays && !sum.todays.done) { sessionKey = sum.todays.key; title = `Today · Week ${sum.todays.week} ${sum.todays.name}`; segs = sum.todays.segs; }
  if (coach.state === 'idle' || coach.state === 'done') loadCoach(segs, title);
  const live = tracker.state === 'running' || tracker.state === 'paused';
  const coachOnly = lsGet('stride.coachOnly', false);

  view.innerHTML = `
    <div class="section-title"><h1>Track</h1>${live ? '<span class="pill live">Live</span>' : ''}</div>
    ${!live ? `<section class="card" id="setup">
      <div class="form-grid">
        <div class="field"><label>Activity</label><div class="seg" id="type-seg"><button data-t="Running" class="${tracker.type === 'Running' ? 'active' : ''}">Run</button><button data-t="Walking" class="${tracker.type === 'Walking' ? 'active' : ''}">Walk</button></div></div>
        <div class="field"><label for="session-sel">Coach</label><select id="session-sel">
          ${sum.todays ? `<option value="${sum.todays.key}" ${sessionKey === sum.todays.key ? 'selected' : ''}>Today: Week ${sum.todays.week} ${sum.todays.name}</option>` : ''}
          ${sum.next && (!sum.todays || sum.next.key !== sum.todays.key) ? `<option value="${sum.next.key}" ${sessionKey === sum.next.key ? 'selected' : ''}>Next: Week ${sum.next.week} ${sum.next.name}</option>` : ''}
          ${PRESETS.map(p => `<option value="${p.key}" ${!sessionKey && title === p.name ? 'selected' : ''}>${p.name}</option>`).join('')}
          <optgroup label="Plan sessions">${getPlan().flatMap(w => w.sessions).map(ss => `<option value="${ss.key}" ${sessionKey === ss.key && !(sum.todays?.key === ss.key) && !(sum.next?.key === ss.key) ? 'selected' : ''}>W${ss.week} ${ss.name} · ${ss.desc}</option>`).join('')}</optgroup>
        </select></div>
      </div>
      <p class="small muted" style="margin-top:10px">${segs.length ? `<b>${esc(title)}</b>: ${describeSegments(segs)}. You'll hear a voice cue and two beeps when it's time to run, one beep to walk.` : 'No cues. Just GPS, time and pace.'}</p>
      <label class="small" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="coach-only" ${coachOnly ? 'checked' : ''}> Coach only (treadmill or indoor, no GPS)</label>
    </section>` : ''}

    <section class="card" id="live">
      <div class="live-main"><div class="v" id="t-elapsed">0:00</div><div class="l">${coachOnly && !live ? 'Session time' : 'Elapsed'}</div></div>
      <div class="live-stats" style="margin-top:14px">
        <div class="live-stat"><div class="v" id="t-dist">0.00</div><div class="l">${distUnit(u)}</div></div>
        <div class="live-stat"><div class="v" id="t-pace">–</div><div class="l">Pace /${distUnit(u)}</div></div>
        <div class="live-stat"><div class="v" id="t-avg">–</div><div class="l">Avg pace</div></div>
      </div>
      <p class="small muted" style="margin-top:10px;text-align:center" id="t-gps"><span class="gps-dot"></span>GPS idle</p>
    </section>

    <section class="coach" id="coach" ${segs.length ? '' : 'hidden'}>
      <div class="kind" id="c-kind">Ready</div>
      <div class="left" id="c-left">${fmtDur(coachTotal())}</div>
      <div class="next" id="c-next">${esc(title)}</div>
      <div class="coach-strip" id="c-strip">${segs.map(sg => `<i class="${sg.kind}" style="flex:${sg.sec}"></i>`).join('')}</div>
    </section>

    <div id="map" class="map tall" ${coachOnly && !live ? 'hidden' : ''}></div>

    <div class="btn-row" id="controls" style="justify-content:center"></div>
    <div id="finish" hidden></div>
    <div class="notice small">Keep Stride open and your screen on while tracking. iPhones stop sending location to a web page when the screen locks. Add Stride to your Home Screen for a full-screen, app-like experience.</div>`;

  const $ = sel => view.querySelector(sel);
  $('#type-seg')?.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { tracker.type = b.dataset.t; $('#type-seg').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); }));
  $('#session-sel')?.addEventListener('change', e => { location.hash = `#track/${e.target.value}`; });
  $('#coach-only')?.addEventListener('change', e => { lsSet('stride.coachOnly', e.target.checked); renderTrack(arg); });

  // map
  if (window.L && !$('#map').hidden) {
    map = makeMap($('#map'), { zoomControl: false });
    map.setView([tracker.lastFix?.[0] || 39.5, tracker.lastFix?.[1] || -98.35], tracker.lastFix ? 16 : 3);
    line = L.polyline(tracker.pts.map(p => [p[0], p[1]]), lineStyle()).addTo(map);
    marker = L.circleMarker([0, 0], { radius: 7, color: '#fff', weight: 2, fillColor: '#e3b53b', fillOpacity: 1 }).addTo(map);
    if (tracker.pts.length) { map.fitBounds(line.getBounds(), { padding: [30, 30] }); }
    else if (!live && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(p => { map.setView([p.coords.latitude, p.coords.longitude], 15); marker.setLatLng([p.coords.latitude, p.coords.longitude]); }, () => {}, { timeout: 8000, maximumAge: 60000 });
    }
  }

  function renderControls() {
    const c = $('#controls'); if (!c) return;
    const st = coachOnly ? coach.state : tracker.state;
    const mode = coachOnly ? 'coach' : 'gps';
    if (st === 'idle' || (mode === 'coach' && st === 'done' && !$('#finish').innerHTML)) {
      c.innerHTML = `<button class="btn big" id="b-start">${coachOnly ? 'Start session' : 'Start'}</button>`;
    } else if (st === 'running') {
      c.innerHTML = `<button class="btn secondary big" id="b-pause">Pause</button>${segs.length && coach.state !== 'done' ? '<button class="btn secondary" id="b-skip">Skip segment</button>' : ''}<button class="btn big" id="b-stop">Finish</button>`;
    } else if (st === 'paused') {
      c.innerHTML = `<button class="btn big" id="b-resume">Resume</button><button class="btn secondary big" id="b-stop">Finish</button>`;
    } else { c.innerHTML = ''; }
    $('#b-start')?.addEventListener('click', onStart);
    $('#b-pause')?.addEventListener('click', () => { if (!coachOnly) pauseTracking(); pauseCoach(); renderControls(); });
    $('#b-resume')?.addEventListener('click', () => { if (!coachOnly) resumeTracking(); if (segs.length) startCoach(); renderControls(); });
    $('#b-skip')?.addEventListener('click', skipSegment);
    $('#b-stop')?.addEventListener('click', onFinish);
  }
  function onStart() {
    primeAudio();
    if (segs.length) startCoach();
    if (!coachOnly) startTracking(tracker.type);
    else { coachStart = Date.now(); }
    $('#setup')?.remove();
    renderControls();
  }
  let coachStart = null;
  function onFinish() {
    let result;
    if (coachOnly) {
      const sec = Math.round(coachElapsed());
      pauseCoach();
      result = { workout: { id: 'stride:' + Math.random().toString(36).slice(2, 10), source: 'stride', device: 'Stride coach', type: tracker.type, start: new Date(coachStart || Date.now() - sec * 1000).toISOString(), end: new Date().toISOString(), durationSec: sec, distanceKm: null, indoor: true }, route: null };
    } else {
      result = stopTracking();
      pauseCoach();
    }
    const w = result.workout;
    $('#controls').innerHTML = '';
    const f = $('#finish'); f.hidden = false;
    f.innerHTML = `<section class="card">
      <h2>Save this ${w.type === 'Walking' ? 'walk' : 'run'}?</h2>
      <dl class="detail-list" style="margin:10px 0">
        <dt>Time</dt><dd>${fmtDur(w.durationSec)}</dd>
        ${w.distanceKm != null ? `<dt>Distance</dt><dd>${fmtDistU(w.distanceKm, u)}</dd><dt>Pace</dt><dd>${fmtPaceU(w.distanceKm > 0 ? w.durationSec / w.distanceKm : null, u)}</dd>` : ''}
        ${result.route ? `<dt>GPS points</dt><dd>${result.route.n}</dd>` : ''}
        ${sessionKey ? `<dt>Plan session</dt><dd>${esc(title)}</dd>` : ''}
      </dl>
      <div class="btn-row"><button class="btn" id="save">Save</button><button class="btn danger" id="discard">Discard</button></div>
    </section>`;
    $('#save').addEventListener('click', async () => {
      await addRecordedWorkout(w, result.route);
      if (sessionKey) toggleSession(sessionKey, true);
      stopCoach(); resetTracker();
      toast('Saved');
      location.hash = `#run/${encodeURIComponent(w.id)}`;
    });
    $('#discard').addEventListener('click', () => { stopCoach(); resetTracker(); toast('Discarded'); renderTrack(arg); });
  }

  const offT = onTracker(t => {
    if (!$('#t-elapsed')) return;
    if (!coachOnly) $('#t-elapsed').textContent = fmtDur(elapsedSec());
    $('#t-dist').textContent = fmtDist(t.distanceM / 1000, u);
    $('#t-pace').textContent = fmtPace(currentPaceSecPerKm(), u);
    $('#t-avg').textContent = fmtPace(avgPaceSecPerKm(), u);
    const g = $('#t-gps');
    if (t.error) g.innerHTML = `<span class="gps-dot bad"></span>${esc(t.error)}`;
    else if (t.state === 'idle' || t.state === 'done') g.innerHTML = '<span class="gps-dot"></span>GPS idle';
    else if (t.accuracy == null) g.innerHTML = '<span class="gps-dot weak"></span>Waiting for GPS…';
    else g.innerHTML = `<span class="gps-dot ${t.accuracy <= 15 ? 'ok' : t.accuracy <= 40 ? 'weak' : 'bad'}"></span>GPS ±${Math.round(t.accuracy)} m · ${t.pts.length} points${t.elevGainM > 0 ? ` · ↑ ${fmtElev(t.elevGainM, u)}` : ''}`;
    if (map && t.lastFix) {
      marker.setLatLng([t.lastFix[0], t.lastFix[1]]);
      if (t.pts.length && line.getLatLngs().length !== t.pts.length) line.setLatLngs(t.pts.map(p => [p[0], p[1]]));
      if (t.state === 'running') map.setView([t.lastFix[0], t.lastFix[1]], Math.max(map.getZoom(), 16), { animate: false });
    }
  });
  const offC = onCoach(c => {
    const box = $('#coach'); if (!box) return;
    if (coachOnly && $('#t-elapsed')) $('#t-elapsed').textContent = fmtDur(coachElapsed());
    const seg = c.segs[c.idx];
    box.className = 'coach ' + (c.state === 'running' || c.state === 'paused' ? (seg?.kind || '') : '');
    const label = { warmup: 'Warm up', run: 'Run', walk: 'Walk', cooldown: 'Cool down' };
    if (c.state === 'idle') { $('#c-kind').textContent = 'Ready'; $('#c-left').textContent = fmtDur(coachTotal()); $('#c-next').textContent = c.title; }
    else if (c.state === 'done') { $('#c-kind').textContent = 'Done'; $('#c-left').textContent = fmtDur(coachTotal()); $('#c-next').textContent = 'Session complete. Tap Finish to save.'; renderControls(); }
    else {
      $('#c-kind').textContent = (c.state === 'paused' ? 'Paused · ' : '') + (label[seg.kind] || seg.kind);
      $('#c-left').textContent = fmtDur(c.segLeft);
      const nx = c.segs[c.idx + 1];
      $('#c-next').textContent = nx ? `Next: ${label[nx.kind].toLowerCase()} ${fmtDur(nx.sec)} · ${c.idx + 1}/${c.segs.length}` : 'Last segment';
    }
    $('#c-strip').querySelectorAll('i').forEach((i, idx) => i.classList.toggle('done', idx < c.idx));
  });
  renderControls();
  tracker.listeners.forEach(fn => fn(tracker));
  coach.listeners.forEach(fn => fn(coach));
  cleanup = () => { offT(); offC(); if (map) { map.remove(); map = null; } };
}

// ---------- Steps ----------
function renderSteps() {
  const s = S(), u = s.units;
  const today = dayKey(new Date());
  const health = latestDaily('steps', 30);
  const byDay = Object.fromEntries(health.map(x => [x.day, x.v]));
  const days = [];
  for (let i = 29; i >= 0; i--) { const k = dayKey(addDays(new Date(), -i)); days.push({ key: k, v: byDay[k] || 0 }); }
  const live = todayCount();
  days[days.length - 1].v = Math.max(days[days.length - 1].v, live);
  const last7 = days.slice(-7), avg7 = last7.reduce((a, d) => a + d.v, 0) / 7;
  const best = days.reduce((a, d) => d.v > a.v ? d : a, days[0]);
  const atGoal = days.filter(d => d.v >= s.stepGoal).length;
  const todayV = days[days.length - 1].v;
  const pct = Math.min(100, Math.round((todayV / s.stepGoal) * 100));
  view.innerHTML = `
    <div class="section-title"><h1>Steps</h1><span class="muted small">goal ${fmtInt(s.stepGoal)}</span></div>
    <section class="card" style="text-align:center">
      <div class="eyebrow">Today</div>
      <div class="big-count" id="p-count">${fmtInt(todayV)}</div>
      <div class="progress" style="margin:12px auto;max-width:360px"><i style="width:${pct}%"></i></div>
      <p class="small muted" id="p-sub">${pct >= 100 ? 'Goal reached.' : `${fmtInt(s.stepGoal - todayV)} to go`}${byDay[today] ? ` · Health reports ${fmtInt(byDay[today])}` : ''}</p>
      <div class="live-stats" style="margin-top:14px;max-width:420px;margin-inline:auto">
        <div class="live-stat"><div class="v" id="p-live">${fmtInt(live)}</div><div class="l">Counted here</div></div>
        <div class="live-stat"><div class="v" id="p-cad">${pedometer.cadence || '–'}</div><div class="l">Cadence</div></div>
        <div class="live-stat"><div class="v" id="p-dist">${fmtDist(live * s.strideM / 1000, u)}</div><div class="l">est. ${distUnit(u)}</div></div>
      </div>
      <div class="btn-row" style="justify-content:center;margin-top:14px">
        <button class="btn ${pedometer.running ? 'secondary' : ''}" id="p-toggle">${pedometer.running ? 'Stop counting' : 'Start counting'}</button>
        <button class="btn ghost" id="p-reset">Reset today</button>
      </div>
      <p class="small muted" style="margin-top:10px" id="p-note">${pedometer.supported ? 'The live counter uses this phone\'s motion sensor and only counts while Stride is open with the screen on. Your Apple Health import is the complete record.' : 'No motion sensor is available in this browser. Step history comes from your Apple Health import.'}</p>
    </section>
    <section class="card">
      <div class="card-head"><h2>Last 30 days</h2><span class="sub">from Apple Health</span></div>
      <div id="chart-steps"></div>
    </section>
    <section class="tiles">
      <div class="tile"><span class="label">7-day average</span><span class="value">${fmtInt(avg7)}</span></div>
      <div class="tile"><span class="label">Best day</span><span class="value">${fmtInt(best.v)}</span><span class="delta">${best.v ? relDay(best.key) : ''}</span></div>
      <div class="tile"><span class="label">Days at goal</span><span class="value">${atGoal}<small>/30</small></span></div>
      <div class="tile"><span class="label">Running cadence target</span><span class="value">170<small>–180 spm</small></span><span class="delta">quick, light steps</span></div>
    </section>`;
  barChart(view.querySelector('#chart-steps'), {
    data: days.map((d, i) => ({ label: keyToDate(d.key).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }), value: d.v, hl: i === days.length - 1, key: d.key })),
    goal: s.stepGoal, goalLabel: 'goal', yFormat: v => v >= 1000 ? `${Math.round(v / 1000)}K` : String(v),
    tipFormat: d => `<b>${fmtInt(d.value)}</b> steps · ${relDay(d.key)}`,
  });
  const $ = sel => view.querySelector(sel);
  $('#p-toggle').addEventListener('click', async () => {
    if (pedometer.running) { stopPedometer(); renderSteps(); return; }
    try { await startPedometer(); renderSteps(); } catch (e) { $('#p-note').textContent = e.message; $('#p-note').classList.add('notice', 'bad'); }
  });
  $('#p-reset').addEventListener('click', () => { resetToday(); renderSteps(); });
  const off = onPedometer(p => {
    if (!$('#p-live')) return;
    $('#p-live').textContent = fmtInt(p.steps);
    $('#p-cad').textContent = p.cadence || '–';
    $('#p-dist').textContent = fmtDist(p.steps * s.strideM / 1000, u);
    const v = Math.max(byDay[today] || 0, p.steps);
    $('#p-count').textContent = fmtInt(v);
    const pc = Math.min(100, Math.round((v / s.stepGoal) * 100));
    view.querySelector('.progress i').style.width = pc + '%';
    $('#p-sub').textContent = pc >= 100 ? 'Goal reached.' : `${fmtInt(s.stepGoal - v)} to go`;
  });
  cleanup = off;
}

// ---------- Plan ----------
function renderPlan() {
  const plan = getPlan(), sum = planSummary();
  const rd = raceDayKey(), ps = planStartKey();
  const pct = Math.round((sum.done / sum.total) * 100);
  view.innerHTML = `
    <div class="section-title"><h1>5K plan</h1><span class="muted small">9 weeks · 27 sessions</span></div>
    <section class="card plan-progress">
      ${ps ? `<div class="card-head"><h2>${sum.done} of ${sum.total} done</h2><span class="sub">race ${rd ? fmtDate(keyToDate(rd)) : ''}</span></div>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <p class="small muted">Started ${fmtDate(keyToDate(ps))}. Sessions check themselves off when a run of 10 minutes or more lands on that day, from Apple Health or Stride. Tap the circle to override.${sum.overdue ? ` ${sum.overdue} past session${sum.overdue === 1 ? '' : 's'} not done. That's fine. Just do the next one.` : ''}</p>
      <div class="btn-row"><a class="btn ghost" href="#settings">Change dates</a></div>`
      : `<h2>Run/walk your way to 5K</h2><p class="muted" style="margin-top:6px">Three sessions a week, 25 to 40 minutes each. Start with one-minute jogs and finish with a 30-minute run on race day. If a week feels hard, repeat it. Nobody is counting.</p>
      <div class="btn-row" style="margin-top:12px"><button class="btn" id="start-plan">Start today</button><a class="btn secondary" href="#settings">Pick dates</a></div>`}
    </section>
    ${plan.map(w => `<section class="week">
      <div class="week-head"><h2>Week ${w.n}</h2><span class="small muted">${esc(w.focus)}</span></div>
      <div class="sessions">${w.sessions.map(ss => `<div class="session ${ss.done ? 'done' : ''} ${ss.today ? 'today' : ''}" data-key="${ss.key}" role="button" tabindex="0">
        <span class="check" data-toggle="${ss.key}" title="Mark done">${ss.done ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>' : ''}</span>
        <span class="d">${ss.date ? (ss.today ? 'Today' : fmtDate(keyToDate(ss.date))) : `Day ${ss.day}`}</span>
        <span class="n">${esc(ss.name)}</span>
        <span class="m">${esc(ss.desc)}</span>
      </div>`).join('')}</div>
    </section>`).join('')}`;
  view.querySelector('#start-plan')?.addEventListener('click', () => { startPlanToday(); toast('Plan started'); raceChip(); renderPlan(); });
  view.querySelectorAll('[data-toggle]').forEach(c => c.addEventListener('click', ev => {
    ev.stopPropagation();
    const key = c.dataset.toggle; const ss = sessionByKey(key);
    toggleSession(key, !ss.done); renderPlan();
  }));
  view.querySelectorAll('.session').forEach(el => {
    const go = () => { location.hash = `#track/${el.dataset.key}`; };
    el.addEventListener('click', go);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

// ---------- Settings & import ----------
function renderSettings() {
  const s = S();
  const theme = lsGet('stride.theme', 'system');
  const goal = `${Math.floor(s.goalTimeSec / 60)}:${String(s.goalTimeSec % 60).padStart(2, '0')}`;
  view.innerHTML = `
    <h1>Settings</h1>
    <section class="card">
      <div class="card-head"><h2>Import Apple Health</h2>${store.meta.lastImport ? `<span class="sub">last import ${fmtDate(store.meta.lastImport)}</span>` : ''}</div>
      ${store.meta.demo ? '<div class="notice warn" style="margin-bottom:10px">Demo data is loaded. Importing will replace it.</div>' : ''}
      <div class="dropzone" id="drop" tabindex="0" role="button">
        <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3 7 8h3v6h4V8h3l-5-5Zm-7 13v4h14v-4h-2v2H7v-2H5Z"/></svg>
        <b>Choose export.zip</b>
        <span class="small">or export.xml, workout-routes GPX files, or a health.json from the converter</span>
        <input type="file" id="file" multiple accept=".zip,.xml,.gpx,.json,application/zip,text/xml,application/json" hidden>
      </div>
      <div id="import-status" style="margin-top:10px" hidden><div class="progress"><i id="import-bar"></i></div><p class="small muted" id="import-msg" style="margin-top:6px"></p></div>
      <details style="margin-top:12px"><summary class="small" style="cursor:pointer;font-weight:600">How to export from your iPhone</summary>
        <ol class="steps-list small" style="margin-top:10px">
          <li>Open <b>Health</b>, tap your profile picture (top right).</li>
          <li>Scroll down and tap <b>Export All Health Data</b>, then <b>Export</b>. Wait for the share sheet.</li>
          <li>Choose <b>Save to Files</b>. The file is export.zip. Large libraries can be a gigabyte and take a while; that's normal.</li>
          <li>Back here, tap the box above and pick export.zip from Files. Stride reads the zip in place and keeps only workouts, routes, steps, resting heart rate and VO2 max.</li>
        </ol>
        <p class="small muted" style="margin-top:8px">Faster on a Mac: <code>python3 tools/convert_export.py ~/Downloads/export.zip -o health.json</code> then import health.json. Re-importing is safe; workouts are matched by start time and never duplicated.</p>
      </details>
      <div class="btn-row" style="margin-top:12px"><button class="btn secondary" id="demo">Load demo data</button></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Race and plan</h2></div>
      <div class="form-grid">
        <div class="field"><label for="race">Race day</label><input type="date" id="race" value="${s.raceDate}"></div>
        <div class="field"><label for="goal">Goal 5K time (mm:ss)</label><input type="text" id="goal" inputmode="numeric" value="${goal}" placeholder="30:00"></div>
        <div class="field"><label for="pstart">Plan start (week 1, day 1)</label><input type="date" id="pstart" value="${s.planStart || planStartKey() || ''}"></div>
      </div>
      <p class="small muted" style="margin-top:8px">The plan is 9 weeks with race day as its last session. Set either date and Stride fills in the other; set both to use your own schedule.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>Preferences</h2></div>
      <div class="form-grid">
        <div class="field"><label>Units</label><div class="seg" id="units"><button data-u="mi" class="${s.units === 'mi' ? 'active' : ''}">Miles</button><button data-u="km" class="${s.units === 'km' ? 'active' : ''}">Kilometers</button></div></div>
        <div class="field"><label for="theme">Appearance</label><select id="theme"><option value="system" ${theme === 'system' ? 'selected' : ''}>Match system</option><option value="light" ${theme === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${theme === 'dark' ? 'selected' : ''}>Dark</option></select></div>
        <div class="field"><label for="stepgoal">Daily step goal</label><input type="number" id="stepgoal" min="1000" step="500" value="${s.stepGoal}"></div>
        <div class="field"><label for="stride">Stride length (cm, for live step distance)</label><input type="number" id="stride" min="30" max="200" value="${Math.round(s.strideM * 100)}"></div>
        <div class="field"><label for="age">Age (for heart-rate zones)</label><input type="number" id="age" min="10" max="100" value="${s.age}" placeholder="optional"></div>
        <div class="field"><label for="maxhr">Max heart rate (overrides age)</label><input type="number" id="maxhr" min="120" max="230" value="${s.maxHR}" placeholder="optional"></div>
      </div>
      ${(s.maxHR || s.age) ? `<div class="table-wrap" style="margin-top:12px"><table class="splits"><thead><tr><th>Zone</th><th>bpm</th></tr></thead><tbody>${hrZones(s.maxHR ? +s.maxHR : 220 - +s.age).map(z => `<tr><td>${z.name}</td><td>${z.lo}–${z.hi}</td></tr>`).join('')}</tbody></table></div>` : ''}
    </section>

    <section class="card">
      <div class="card-head"><h2>Your data</h2></div>
      <p class="small muted">Everything lives in this browser on this device: ${store.workouts.length} workouts and ${Object.keys(store.daily).length} days of daily stats. Nothing is uploaded anywhere.</p>
      <div class="btn-row" style="margin-top:12px"><button class="btn secondary" id="backup">Download backup (JSON)</button><button class="btn danger" id="erase">Erase all data</button></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Install on your phone</h2></div>
      <p class="small muted">Open Stride in Safari, tap Share, then <b>Add to Home Screen</b>. It opens full-screen and works offline. GPS and the pedometer need the page served over HTTPS (or localhost).</p>
    </section>`;

  const $ = sel => view.querySelector(sel);
  const drop = $('#drop'), file = $('#file');
  drop.addEventListener('click', () => file.click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files.length) runImport(e.dataTransfer.files); });
  file.addEventListener('change', () => { if (file.files.length) runImport(file.files); });
  $('#demo').addEventListener('click', loadDemo);

  $('#race').addEventListener('change', e => { setSettings({ raceDate: e.target.value }); raceChip(); toast('Race day saved'); });
  $('#pstart').addEventListener('change', e => { setSettings({ planStart: e.target.value }); toast('Plan start saved'); });
  $('#goal').addEventListener('change', e => {
    const m = e.target.value.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) { toast('Use mm:ss, like 32:30'); return; }
    setSettings({ goalTimeSec: +m[1] * 60 + +m[2] }); toast('Goal saved');
  });
  $('#units').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { setSettings({ units: b.dataset.u }); renderSettings(); }));
  $('#theme').addEventListener('change', e => { lsSet('stride.theme', e.target.value); applyTheme(); });
  $('#stepgoal').addEventListener('change', e => setSettings({ stepGoal: Math.max(1000, +e.target.value || 8000) }));
  $('#stride').addEventListener('change', e => setSettings({ strideM: Math.max(0.3, Math.min(2, (+e.target.value || 75) / 100)) }));
  $('#age').addEventListener('change', e => { setSettings({ age: e.target.value }); renderSettings(); });
  $('#maxhr').addEventListener('change', e => { setSettings({ maxHR: e.target.value }); renderSettings(); });
  $('#backup').addEventListener('click', async () => { const all = await exportAll(); download(`stride-backup-${dayKey(new Date())}.json`, JSON.stringify(all), 'application/json'); });
  $('#erase').addEventListener('click', async ev => {
    const b = ev.currentTarget;
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to erase everything'; return; }
    await eraseAll(); toast('All data erased'); raceChip(); renderSettings();
  });
}

async function runImport(files) {
  const status = view.querySelector('#import-status'), bar = view.querySelector('#import-bar'), msg = view.querySelector('#import-msg');
  if (status) { status.hidden = false; bar.style.width = '2%'; msg.textContent = 'Starting…'; }
  try {
    const t0 = Date.now();
    const result = await importFiles(files, p => {
      if (!bar) return;
      bar.style.width = `${Math.max(2, Math.round(p.frac * 100))}%`;
      msg.textContent = `${p.label} · ${p.workouts} workouts · ${p.routes} routes · ${p.records.toLocaleString()} daily records`;
    });
    if (store.meta.demo) await eraseAll();
    const m = await mergeImport(result);
    if (bar) { bar.style.width = '100%'; msg.textContent = `Done in ${Math.round((Date.now() - t0) / 1000)}s: ${m.workouts} workouts, ${m.routes} routes, ${m.days} days of stats.`; }
    toast(`Imported ${m.workouts} workouts`);
    raceChip();
    setTimeout(() => { if (current === 'settings') renderSettings(); }, 1500);
  } catch (e) {
    console.error(e);
    if (msg) { msg.textContent = 'Import failed: ' + e.message; msg.className = 'notice bad'; }
    toast('Import failed');
  }
}
window.Stride = { importBlobs: runImport, store, loadDemo };

// ---------- theme & router ----------
function applyTheme() {
  const t = lsGet('stride.theme', 'system');
  if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
}
const VIEWS = { home: renderHome, runs: renderRuns, run: renderRun, track: renderTrack, steps: renderSteps, plan: renderPlan, settings: renderSettings };
function navigate() {
  const hash = location.hash.replace(/^#/, '') || 'home';
  const i = hash.indexOf('/');
  const name = i >= 0 ? hash.slice(0, i) : hash, arg = i >= 0 ? decodeURIComponent(hash.slice(i + 1)) : null;
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  current = name;
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === (name === 'run' ? 'runs' : name)));
  window.scrollTo(0, 0);
  raceChip();
  (VIEWS[name] || renderHome)(arg);
}
applyTheme();
window.addEventListener('hashchange', navigate);
onChange(() => { if (current === 'home' || current === 'runs' || current === 'plan') navigate(); });
loadStore().then(() => { raceChip(); navigate(); });
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
