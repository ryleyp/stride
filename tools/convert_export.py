#!/usr/bin/env python3
"""Convert an Apple Health export (export.zip or an unzipped apple_health_export folder)
into a compact health.json that Stride imports in a second or two.

Usage:
  python3 tools/convert_export.py ~/Downloads/export.zip -o health.json
  python3 tools/convert_export.py ~/Downloads/apple_health_export -o health.json

Keeps only what Stride uses: workouts (with routes), daily steps, walking+running
distance, exercise minutes, resting heart rate, VO2 max. Nothing leaves your machine.
"""
import argparse, io, json, math, os, re, sys, zipfile
from datetime import datetime

WANTED = {
    'HKQuantityTypeIdentifierStepCount': 'steps',
    'HKQuantityTypeIdentifierDistanceWalkingRunning': 'dist',
    'HKQuantityTypeIdentifierRestingHeartRate': 'rhr',
    'HKQuantityTypeIdentifierVO2Max': 'vo2',
    'HKQuantityTypeIdentifierAppleExerciseTime': 'exmin',
}
KM_PER_MI = 1.609344
ATTR = lambda name: re.compile(r' %s="([^"]*)"' % name)
RX = {k: ATTR(k) for k in ['startDate', 'endDate', 'value', 'unit', 'sourceName', 'type', 'sum', 'average', 'maximum',
                           'key', 'workoutActivityType', 'duration', 'durationUnit', 'totalDistance', 'totalDistanceUnit',
                           'totalEnergyBurned', 'path', 'lat', 'lon']}
RECORD_RX = re.compile(r'<Record type="([^"]+)"')


def get(s, name):
    m = RX[name].search(s)
    return m.group(1) if m else None


def num(s, name):
    v = get(s, name)
    try:
        return float(v) if v is not None else None
    except ValueError:
        return None


def to_km(v, unit):
    if v is None:
        return None
    return {'km': v, 'mi': v * KM_PER_MI, 'm': v / 1000, 'yd': v * 0.0009144, 'ft': v * 0.0003048}.get(unit or 'km', v)


def apple_iso(s):
    m = re.match(r'^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$', s or '')
    return f'{m.group(1)}T{m.group(2)}{m.group(3)}:{m.group(4)}' if m else s


def unescape(s):
    return None if s is None else s.replace('&apos;', "'").replace('&quot;', '"').replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')


def haversine(lat1, lon1, lat2, lon2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat, dlon = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


class Scanner:
    def __init__(self):
        self.workouts, self.daily, self.records = [], {}, 0
        self.in_workout, self.wbuf = False, []

    def line(self, l):
        if self.in_workout:
            self.wbuf.append(l)
            if '</Workout>' in l:
                self.in_workout = False
                self.workout('\n'.join(self.wbuf))
                self.wbuf = []
            return
        m = RECORD_RX.search(l)
        if m:
            self.record(l, m.group(1))
            return
        if '<Workout ' in l:
            if l.rstrip().endswith('/>'):
                self.workout(l)
            else:
                self.in_workout, self.wbuf = True, [l]

    def end(self):
        if self.in_workout:
            self.workout('\n'.join(self.wbuf))

    def record(self, l, typ):
        kind = WANTED.get(typ)
        if not kind:
            return
        start, value = get(l, 'startDate'), num(l, 'value')
        if not start or value is None:
            return
        self.records += 1
        d = self.daily.setdefault(start[:10], {})
        if kind == 'rhr':
            d['rhr'] = value
            return
        if kind == 'vo2':
            d['vo2'] = value
            return
        src = get(l, 'sourceName') or '?'
        if kind == 'dist':
            value = to_km(value, get(l, 'unit'))
        by = d.setdefault('_' + kind, {})
        by[src] = by.get(src, 0) + value

    def workout(self, x):
        open_tag = x[:x.index('>') + 1]
        typ = (get(open_tag, 'workoutActivityType') or 'HKWorkoutActivityTypeOther').replace('HKWorkoutActivityType', '')
        start_a, end_a = get(open_tag, 'startDate'), get(open_tag, 'endDate')
        if not start_a:
            return
        start, end = apple_iso(start_a), apple_iso(end_a) if end_a else None
        dur, du = num(open_tag, 'duration'), get(open_tag, 'durationUnit') or 'min'
        if dur is not None:
            dur = dur * 60 if du == 'min' else dur * 3600 if du == 'hr' else dur
        elif end:
            dur = (datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds()
        dist = to_km(num(open_tag, 'totalDistance'), get(open_tag, 'totalDistanceUnit'))
        kcal = num(open_tag, 'totalEnergyBurned')
        avg_hr = max_hr = elev = temp = None
        indoor = False
        for s in re.findall(r'<WorkoutStatistics( [^>]*)/?>', x):
            t = get(s, 'type') or ''
            if t in ('HKQuantityTypeIdentifierDistanceWalkingRunning', 'HKQuantityTypeIdentifierDistanceCycling', 'HKQuantityTypeIdentifierDistanceSwimming'):
                v = to_km(num(s, 'sum'), get(s, 'unit'))
                if v is not None:
                    dist = v
            elif t == 'HKQuantityTypeIdentifierActiveEnergyBurned':
                v = num(s, 'sum')
                if v is not None:
                    kcal = v
            elif t == 'HKQuantityTypeIdentifierHeartRate':
                avg_hr, max_hr = num(s, 'average'), num(s, 'maximum')
        for s in re.findall(r'<MetadataEntry( [^>]*)/?>', x):
            k, v = get(s, 'key'), get(s, 'value')
            if k == 'HKIndoorWorkout':
                indoor = v == '1'
            elif k == 'HKElevationAscended' and v:
                try:
                    n = float(v.split()[0])
                    elev = n / 100 if 'cm' in v else n
                except ValueError:
                    pass
            elif k == 'HKWeatherTemperature' and v:
                try:
                    n = float(v.split()[0])
                    temp = (n - 32) * 5 / 9 if 'degF' in v else n
                except ValueError:
                    pass
        fm = re.search(r'<FileReference path="([^"]+)"', x)
        self.workouts.append({
            'id': f'apple:{start}:{typ}', 'source': 'apple', 'device': unescape(get(open_tag, 'sourceName')) or 'Apple',
            'type': typ, 'start': start, 'end': end, 'durationSec': round(dur) if dur is not None else None,
            'distanceKm': dist, 'kcal': round(kcal) if kcal is not None else None,
            'avgHR': round(avg_hr) if avg_hr is not None else None, 'maxHR': round(max_hr) if max_hr is not None else None,
            'indoor': indoor, 'elevGainM': elev, 'tempC': temp, 'routePath': fm.group(1) if fm else None,
        })

    def finish(self):
        for d in self.daily.values():
            for kind in ('steps', 'dist', 'exmin'):
                by = d.pop('_' + kind, None)
                if by:
                    d[kind] = max(by.values())
            if 'steps' in d:
                d['steps'] = round(d['steps'])
        return self.workouts, self.daily


def parse_gpx(text):
    pts = []
    for attrs, body in re.findall(r'<trkpt([^>]*)>(.*?)</trkpt>', text, re.S):
        lat, lon = get(attrs, 'lat'), get(attrs, 'lon')
        if lat is None or lon is None:
            continue
        ele = re.search(r'<ele>([^<]+)</ele>', body)
        tm = re.search(r'<time>([^<]+)</time>', body)
        t = None
        if tm:
            try:
                t = round(datetime.fromisoformat(tm.group(1).replace('Z', '+00:00')).timestamp())
            except ValueError:
                t = None
        pts.append([round(float(lat), 6), round(float(lon), 6), round(float(ele.group(1)), 1) if ele else None, t])
    return pts


def finalize_route(pts, max_pts=1200):
    dist = sum(haversine(*pts[i - 1][:2], *pts[i][:2]) for i in range(1, len(pts)))
    eles = [p[2] for p in pts if p[2] is not None]
    gain = 0.0
    if len(eles) > 5:
        sm = [sum(eles[max(0, i - 2):min(len(eles), i + 3)]) / (min(len(eles), i + 3) - max(0, i - 2)) for i in range(len(eles))]
        gain = sum(max(0, sm[i] - sm[i - 1]) for i in range(1, len(sm)))
    ts = [p[3] for p in pts if p[3]]
    if len(pts) > max_pts:
        step = len(pts) / max_pts
        ds = [pts[int(i * step)] for i in range(max_pts)]
        if ds[-1] is not pts[-1]:
            ds.append(pts[-1])
    else:
        ds = pts
    return {'pts': ds, 'distanceM': dist, 'elevGainM': gain, 'durationSec': (ts[-1] - ts[0]) if len(ts) > 1 else None, 'n': len(pts)}


def norm_route(p):
    return re.sub(r'^.*workout-routes/', '', p).lstrip('/')


def iter_entries(path):
    """Yields (name, binary_file_object) for export.xml and gpx files."""
    if os.path.isdir(path):
        for root, _, files in os.walk(path):
            for f in files:
                if f == 'export.xml' or f.lower().endswith('.gpx'):
                    full = os.path.join(root, f)
                    with open(full, 'rb') as fh:
                        yield full, fh
    else:
        with zipfile.ZipFile(path) as z:
            for info in z.infolist():
                if info.filename.endswith('/export.xml') or info.filename == 'export.xml' or info.filename.lower().endswith('.gpx'):
                    with z.open(info) as fh:
                        yield info.filename, fh


def convert(src, out, quiet=False):
    sc = Scanner()
    routes_by_path = {}
    for name, fh in iter_entries(src):
        if name.endswith('export.xml'):
            if not quiet:
                print(f'Scanning {name} ...', file=sys.stderr)
            for i, line in enumerate(io.TextIOWrapper(fh, encoding='utf-8', errors='replace')):
                sc.line(line)
                if not quiet and i % 2_000_000 == 0 and i:
                    print(f'  {i:,} lines, {sc.records:,} records kept, {len(sc.workouts)} workouts', file=sys.stderr)
            sc.end()
        else:
            pts = parse_gpx(fh.read().decode('utf-8', 'replace'))
            if len(pts) > 1:
                routes_by_path[norm_route(name)] = finalize_route(pts)
    workouts, daily = sc.finish()
    routes = {}
    for w in workouts:
        rp = w.pop('routePath', None)
        if rp and norm_route(rp) in routes_by_path:
            r = routes_by_path[norm_route(rp)]
            w['routeId'] = 'apple:' + norm_route(rp)
            routes[w['routeId']] = r
            if not w.get('distanceKm') and r['distanceM']:
                w['distanceKm'] = r['distanceM'] / 1000
            if w.get('elevGainM') is None:
                w['elevGainM'] = r['elevGainM']
    result = {'version': 1, 'source': 'convert_export.py', 'workouts': workouts, 'daily': daily, 'routes': routes}
    with open(out, 'w') as fh:
        json.dump(result, fh, separators=(',', ':'))
    if not quiet:
        print(f'Wrote {out}: {len(workouts)} workouts, {len(routes)} routes, {len(daily)} days, {sc.records:,} records', file=sys.stderr)
    return result


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('source', help='export.zip or the unzipped apple_health_export folder')
    ap.add_argument('-o', '--out', default='health.json')
    ap.add_argument('-q', '--quiet', action='store_true')
    a = ap.parse_args()
    convert(a.source, a.out, a.quiet)
