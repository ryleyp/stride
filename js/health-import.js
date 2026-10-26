// Apple Health export importer.
// Accepts: export.zip (straight from the Health app), export.xml, workout-routes/*.gpx,
// or a health.json produced by tools/convert_export.py.
// export.xml can be several hundred MB, so it is scanned line by line in chunks
// and only the record types Stride needs are kept.
import { appleDateToIso, haversine, routeStats, downsample, yieldToUI, KM_PER_MI } from './util.js';

const WANTED = {
  HKQuantityTypeIdentifierStepCount: 'steps',
  HKQuantityTypeIdentifierDistanceWalkingRunning: 'dist',
  HKQuantityTypeIdentifierRestingHeartRate: 'rhr',
  HKQuantityTypeIdentifierVO2Max: 'vo2',
  HKQuantityTypeIdentifierAppleExerciseTime: 'exmin',
};
const RX = {
  start: / startDate="([^"]*)"/, end: / endDate="([^"]*)"/, value: / value="([^"]*)"/, unit: / unit="([^"]*)"/,
  source: / sourceName="([^"]*)"/, type: / type="([^"]*)"/, sum: / sum="([^"]*)"/, avg: / average="([^"]*)"/,
  max: / maximum="([^"]*)"/, min: / minimum="([^"]*)"/, key: / key="([^"]*)"/, path: / path="([^"]*)"/,
  activity: / workoutActivityType="([^"]*)"/, duration: / duration="([^"]*)"/, durationUnit: / durationUnit="([^"]*)"/,
  totalDistance: / totalDistance="([^"]*)"/, totalDistanceUnit: / totalDistanceUnit="([^"]*)"/,
  totalEnergy: / totalEnergyBurned="([^"]*)"/,
};
const get = (s, rx) => { const m = s.match(rx); return m ? m[1] : null; };
const num = (s, rx) => { const v = get(s, rx); const n = v == null ? NaN : parseFloat(v); return isNaN(n) ? null : n; };
function unescapeXml(s) { return s == null ? s : s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
function toKm(v, unit) {
  if (v == null) return null;
  if (!unit || unit === 'km') return v;
  if (unit === 'mi') return v * KM_PER_MI;
  if (unit === 'm') return v / 1000;
  if (unit === 'yd') return v * 0.0009144;
  if (unit === 'ft') return v * 0.0003048;
  return v;
}

export class HealthXmlScanner {
  constructor() {
    this.buf = ''; this.inWorkout = false; this.wbuf = [];
    this.workouts = []; this.daily = {}; this.records = 0; this.lines = 0;
  }
  feed(text) {
    this.buf += text;
    let start = 0, idx;
    while ((idx = this.buf.indexOf('\n', start)) >= 0) { this.line(this.buf.slice(start, idx)); start = idx + 1; }
    this.buf = this.buf.slice(start);
  }
  end() { if (this.buf) this.line(this.buf); this.buf = ''; if (this.inWorkout) { this.parseWorkout(this.wbuf.join('\n')); this.inWorkout = false; } }
  line(l) {
    this.lines++;
    if (this.inWorkout) {
      this.wbuf.push(l);
      if (l.indexOf('</Workout>') >= 0) { this.inWorkout = false; this.parseWorkout(this.wbuf.join('\n')); this.wbuf = []; }
      return;
    }
    const r = l.indexOf('<Record type="');
    if (r >= 0) { this.record(l, r); return; }
    const w = l.indexOf('<Workout ');
    if (w >= 0) {
      if (/\/>\s*$/.test(l)) this.parseWorkout(l);
      else { this.inWorkout = true; this.wbuf = [l]; }
    }
  }
  record(l, r) {
    const tEnd = l.indexOf('"', r + 14);
    const kind = WANTED[l.slice(r + 14, tEnd)];
    if (!kind) return;
    const start = get(l, RX.start); const value = num(l, RX.value);
    if (!start || value == null) return;
    this.records++;
    const day = start.slice(0, 10);
    const d = this.daily[day] || (this.daily[day] = {});
    if (kind === 'rhr') { d.rhr = value; return; }
    if (kind === 'vo2') { d.vo2 = value; return; }
    const src = get(l, RX.source) || '?';
    let v = value;
    if (kind === 'dist') v = toKm(value, get(l, RX.unit));
    const by = d['_' + kind] || (d['_' + kind] = {});
    by[src] = (by[src] || 0) + v;
  }
  parseWorkout(x) {
    const open = x.slice(0, x.indexOf('>') + 1);
    const typeRaw = get(open, RX.activity) || 'HKWorkoutActivityTypeOther';
    const type = typeRaw.replace('HKWorkoutActivityType', '');
    const startA = get(open, RX.start), endA = get(open, RX.end);
    if (!startA) return;
    const start = appleDateToIso(startA), end = endA ? appleDateToIso(endA) : null;
    let dur = num(open, RX.duration); const du = get(open, RX.durationUnit) || 'min';
    if (dur != null) dur = du === 'min' ? dur * 60 : du === 'hr' ? dur * 3600 : dur;
    if (dur == null && end) dur = (new Date(end) - new Date(start)) / 1000;
    let distanceKm = toKm(num(open, RX.totalDistance), get(open, RX.totalDistanceUnit));
    let kcal = num(open, RX.totalEnergy);
    let avgHR = null, maxHR = null, indoor = false, elevGainM = null, routePath = null, tempC = null;
    const statRx = /<WorkoutStatistics( [^>]*)\/?>/g; let m;
    while ((m = statRx.exec(x))) {
      const s = m[1], t = get(s, RX.type) || '';
      if (t === 'HKQuantityTypeIdentifierDistanceWalkingRunning' || t === 'HKQuantityTypeIdentifierDistanceCycling' || t === 'HKQuantityTypeIdentifierDistanceSwimming') {
        const v = toKm(num(s, RX.sum), get(s, RX.unit)); if (v != null) distanceKm = v;
      } else if (t === 'HKQuantityTypeIdentifierActiveEnergyBurned') { const v = num(s, RX.sum); if (v != null) kcal = v; }
      else if (t === 'HKQuantityTypeIdentifierHeartRate') { avgHR = num(s, RX.avg); maxHR = num(s, RX.max); }
    }
    const metaRx = /<MetadataEntry( [^>]*)\/?>/g;
    while ((m = metaRx.exec(x))) {
      const s = m[1], k = get(s, RX.key), v = get(s, RX.value);
      if (k === 'HKIndoorWorkout') indoor = v === '1';
      else if (k === 'HKElevationAscended' && v) { const n = parseFloat(v); if (!isNaN(n)) elevGainM = /cm/.test(v) ? n / 100 : /\bm\b/.test(v) ? n : n / 100; }
      else if (k === 'HKWeatherTemperature' && v) { const n = parseFloat(v); if (!isNaN(n)) tempC = /degF/.test(v) ? (n - 32) * 5 / 9 : n; }
    }
    const fm = x.match(/<FileReference path="([^"]+)"/);
    if (fm) routePath = fm[1];
    const w = {
      id: `apple:${start}:${type}`, source: 'apple', device: unescapeXml(get(open, RX.source)) || 'Apple',
      type, start, end, durationSec: dur != null ? Math.round(dur) : null,
      distanceKm, kcal: kcal != null ? Math.round(kcal) : null, avgHR: avgHR != null ? Math.round(avgHR) : null,
      maxHR: maxHR != null ? Math.round(maxHR) : null, indoor, elevGainM, tempC, routePath,
    };
    this.workouts.push(w);
  }
  finish() {
    // Per day, iPhone and Watch both count steps. Health shows the higher-priority source; we keep the max.
    for (const d of Object.values(this.daily)) {
      for (const kind of ['steps', 'dist', 'exmin']) {
        const by = d['_' + kind];
        if (by) { d[kind] = Math.max(...Object.values(by)); delete d['_' + kind]; }
      }
      if (d.steps != null) d.steps = Math.round(d.steps);
    }
    return { workouts: this.workouts, daily: this.daily };
  }
}

export function parseGpx(text) {
  const pts = [];
  const rx = /<trkpt([^>]*)>([\s\S]*?)<\/trkpt>/g; let m;
  while ((m = rx.exec(text))) {
    const a = m[1], body = m[2];
    const lat = parseFloat(get(a, / lat="([^"]+)"/)), lon = parseFloat(get(a, / lon="([^"]+)"/));
    if (isNaN(lat) || isNaN(lon)) continue;
    const eleS = get(body, /<ele>([^<]+)<\/ele>/), tS = get(body, /<time>([^<]+)<\/time>/);
    const ele = eleS ? parseFloat(eleS) : null;
    const t = tS ? Math.round(Date.parse(tS) / 1000) : null;
    pts.push([+lat.toFixed(6), +lon.toFixed(6), ele != null && !isNaN(ele) ? +ele.toFixed(1) : null, t]);
  }
  return pts;
}
function finalizeRoute(pts) {
  const st = routeStats(pts);
  return { pts: downsample(pts), distanceM: st.distanceM, elevGainM: st.elevGainM, durationSec: st.durationSec, n: pts.length };
}

// Streams a zip with fflate, calling onEntry(name) -> handler(chunkUint8, final) | null
async function streamZip(file, onEntry, onProgress) {
  if (!window.fflate) throw new Error('The unzip library did not load. Check your connection or unzip the export and choose export.xml instead.');
  const CHUNK = 4 * 1024 * 1024;
  let failed = null;
  const unzip = new fflate.Unzip();
  unzip.register(fflate.UnzipInflate);
  unzip.onfile = f => {
    const h = onEntry(f.name, f.size);
    if (!h) return;
    f.ondata = (err, chunk, final) => { if (err) failed = err; else h(chunk, final); };
    f.start();
  };
  for (let off = 0; off < file.size; off += CHUNK) {
    const end = Math.min(file.size, off + CHUNK);
    const ab = await file.slice(off, end).arrayBuffer();
    unzip.push(new Uint8Array(ab), end >= file.size);
    if (failed) throw failed;
    onProgress(end / file.size);
    await yieldToUI();
  }
}

export async function importFiles(files, onProgress = () => {}) {
  const scanner = new HealthXmlScanner();
  const routesByPath = {};
  let jsonResult = null;
  const list = [...files];
  const totalBytes = list.reduce((a, f) => a + f.size, 0) || 1;
  let doneBytes = 0;
  const progress = (frac, label) => onProgress({ frac: Math.min(1, (doneBytes + frac) / totalBytes), label, records: scanner.records, workouts: scanner.workouts.length, routes: Object.keys(routesByPath).length });

  for (const file of list) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.zip')) {
      await streamZip(file, (entry) => {
        const en = entry.toLowerCase();
        if (en.endsWith('/export.xml') || en === 'export.xml') {
          const dec = new TextDecoder();
          return (chunk, final) => { scanner.feed(dec.decode(chunk, { stream: !final })); if (final) scanner.end(); };
        }
        if (en.endsWith('.gpx')) {
          const dec = new TextDecoder(); let txt = '';
          return (chunk, final) => { txt += dec.decode(chunk, { stream: !final }); if (final) { const pts = parseGpx(txt); if (pts.length > 1) routesByPath[normRoute(entry)] = finalizeRoute(pts); } };
        }
        return null;
      }, f => progress(f * file.size, `Reading ${file.name}`));
    } else if (name.endsWith('.xml')) {
      const CHUNK = 8 * 1024 * 1024; const dec = new TextDecoder();
      for (let off = 0; off < file.size; off += CHUNK) {
        const end = Math.min(file.size, off + CHUNK);
        const ab = await file.slice(off, end).arrayBuffer();
        scanner.feed(dec.decode(ab, { stream: end < file.size }));
        progress(end, `Scanning ${file.name}`);
        await yieldToUI();
      }
      scanner.end();
    } else if (name.endsWith('.gpx')) {
      const pts = parseGpx(await file.text());
      if (pts.length > 1) routesByPath[normRoute(file.name)] = finalizeRoute(pts);
    } else if (name.endsWith('.json')) {
      const j = JSON.parse(await file.text());
      jsonResult = mergeJson(jsonResult, j);
    } else {
      throw new Error(`Unsupported file: ${file.name}. Choose export.zip, export.xml, .gpx route files, or a health.json.`);
    }
    doneBytes += file.size;
    progress(0, `Finished ${file.name}`);
  }

  const parsed = scanner.finish();
  const routes = {};
  for (const w of parsed.workouts) {
    if (w.routePath) {
      const r = routesByPath[normRoute(w.routePath)];
      if (r) {
        w.routeId = 'apple:' + normRoute(w.routePath);
        routes[w.routeId] = r;
        if (!w.distanceKm && r.distanceM) w.distanceKm = r.distanceM / 1000;
        if (w.elevGainM == null && r.elevGainM != null) w.elevGainM = r.elevGainM;
      }
    }
    delete w.routePath;
  }
  // Loose GPX files that no workout referenced become their own entries
  const used = new Set(Object.values(routes));
  for (const [path, r] of Object.entries(routesByPath)) {
    if (used.has(r) || !r.durationSec) continue;
    const t0 = r.pts.find(p => p[3])?.[3];
    const start = new Date(t0 * 1000).toISOString();
    const id = 'gpx:' + path;
    routes[id] = r;
    parsed.workouts.push({ id, source: 'apple', device: 'GPX route', type: 'Running', start, end: new Date((t0 + r.durationSec) * 1000).toISOString(), durationSec: Math.round(r.durationSec), distanceKm: r.distanceM / 1000, elevGainM: r.elevGainM, routeId: id });
  }
  let result = { workouts: parsed.workouts, daily: parsed.daily, routes };
  if (jsonResult) result = mergeJson(result, jsonResult);
  result.summary = { records: scanner.records, workouts: result.workouts.length, routes: Object.keys(result.routes).length, days: Object.keys(result.daily).length };
  return result;
}
function normRoute(p) { return p.replace(/^.*workout-routes\//, '').replace(/^\/+/, ''); }
function mergeJson(a, b) {
  if (!a) return { workouts: b.workouts || [], daily: b.daily || {}, routes: b.routes || {} };
  return { workouts: [...a.workouts, ...(b.workouts || [])], daily: { ...a.daily, ...(b.daily || {}) }, routes: { ...a.routes, ...(b.routes || {}) } };
}

export function toGpx(workout, route) {
  const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const pts = route.pts.map(p => `      <trkpt lat="${p[0]}" lon="${p[1]}">${p[2] != null ? `<ele>${p[2]}</ele>` : ''}${p[3] ? `<time>${new Date(p[3] * 1000).toISOString()}</time>` : ''}</trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Stride" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(workout.type)} ${esc(workout.start)}</name><time>${esc(workout.start)}</time></metadata>
  <trk><name>${esc(workout.type)}</name><trkseg>
${pts}
  </trkseg></trk>
</gpx>`;
}
export { haversine };
