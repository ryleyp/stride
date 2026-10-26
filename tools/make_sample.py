#!/usr/bin/env python3
"""Generate a realistic fake Apple Health export.zip (10 weeks of run/walk training)
for testing Stride's importer without real data.

  python3 tools/make_sample.py /path/to/outdir   -> writes export.zip there
"""
import math, os, random, sys, zipfile
from datetime import datetime, timedelta, timezone

random.seed(7)
TZ = '-0500'
CENTER = (30.2640, -97.7530)  # a lakeside loop


def apple(dt):
    return dt.strftime('%Y-%m-%d %H:%M:%S ') + TZ


def iso_utc(dt):
    return (dt + timedelta(hours=5)).replace(tzinfo=timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def route(start, dist_km, dur_sec):
    """A wobbly loop with 1 Hz points."""
    n = int(dur_sec)
    pts = []
    r_lat = dist_km / (2 * math.pi) / 111.0
    r_lon = r_lat / math.cos(math.radians(CENTER[0]))
    for i in range(n + 1):
        a = 2 * math.pi * i / n
        wob = 1 + 0.08 * math.sin(5 * a) + 0.03 * math.sin(11 * a)
        lat = CENTER[0] + r_lat * wob * math.sin(a) + random.gauss(0, 0.000012)
        lon = CENTER[1] + r_lon * wob * math.cos(a) + random.gauss(0, 0.000012)
        ele = 150 + 12 * math.sin(2 * a) + random.gauss(0, 0.4)
        t = start + timedelta(seconds=i)
        pts.append(f'   <trkpt lon="{lon:.6f}" lat="{lat:.6f}"><ele>{ele:.1f}</ele><time>{iso_utc(t)}</time></trkpt>')
    return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Apple Health Export"><trk><name>Route</name><trkseg>\n' + '\n'.join(pts) + '\n</trkseg></trk></gpx>\n'


def main(outdir):
    os.makedirs(outdir, exist_ok=True)
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    monday = today - timedelta(days=(today.weekday()))
    plan_start = monday - timedelta(weeks=9)
    xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<HealthData locale="en_US">',
           f' <ExportDate value="{apple(datetime.now())}"/>',
           ' <Me HKCharacteristicTypeIdentifierBiologicalSex="HKBiologicalSexNotSet"/>']
    routes = {}
    # Daily records: steps from two sources, distance, exercise minutes, resting HR, weekly VO2 max
    for d in range(70):
        day = plan_start + timedelta(days=d)
        if day > today:
            break
        base = random.randint(4200, 9800)
        for src, scale in (('iPhone', 0.82), ('Apple Watch', 1.0)):
            total = int(base * scale)
            chunks = 24
            for c in range(chunks):
                st = day + timedelta(hours=7 + c * 0.6)
                en = st + timedelta(minutes=20)
                v = max(0, int(random.gauss(total / chunks, total / chunks * 0.5)))
                xml.append(f' <Record type="HKQuantityTypeIdentifierStepCount" sourceName="{src}" sourceVersion="10.0" unit="count" creationDate="{apple(en)}" startDate="{apple(st)}" endDate="{apple(en)}" value="{v}"/>')
        xml.append(f' <Record type="HKQuantityTypeIdentifierDistanceWalkingRunning" sourceName="Apple Watch" unit="mi" creationDate="{apple(day)}" startDate="{apple(day + timedelta(hours=8))}" endDate="{apple(day + timedelta(hours=20))}" value="{base * 0.00047:.3f}"/>')
        xml.append(f' <Record type="HKQuantityTypeIdentifierAppleExerciseTime" sourceName="Apple Watch" unit="min" creationDate="{apple(day)}" startDate="{apple(day + timedelta(hours=8))}" endDate="{apple(day + timedelta(hours=20))}" value="{random.randint(12, 45)}"/>')
        rhr = 64 - d * 0.08 + random.gauss(0, 1.5)
        xml.append(f' <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Apple Watch" unit="count/min" creationDate="{apple(day)}" startDate="{apple(day)}" endDate="{apple(day + timedelta(days=1))}" value="{rhr:.0f}"/>')
        if d % 7 == 3:
            vo2 = 33.5 + d * 0.055 + random.gauss(0, 0.3)
            xml.append(f' <Record type="HKQuantityTypeIdentifierVO2Max" sourceName="Apple Watch" unit="mL/min·kg" creationDate="{apple(day)}" startDate="{apple(day + timedelta(hours=9))}" endDate="{apple(day + timedelta(hours=9, minutes=30))}" value="{vo2:.2f}"/>')
    # Workouts: Mon/Wed/Fri run-walks, progressing; plus a weekend walk
    wk = 0
    for d in range(70):
        day = plan_start + timedelta(days=d)
        if day >= today:
            break
        wk = d // 7
        if day.weekday() in (0, 2, 4):
            if random.random() < 0.12:
                continue  # a missed session
            dist = 1.6 + wk * 0.42 + random.gauss(0, 0.15)
            pace = 450 - wk * 16 + random.gauss(0, 10)  # sec per km
            dur = dist * pace
            st = day + timedelta(hours=7, minutes=random.randint(0, 40))
            en = st + timedelta(seconds=dur)
            hr = 150 + wk * 0.8 + random.gauss(0, 3)
            rp = f'/workout-routes/route_{st.strftime("%Y-%m-%d_%I.%M%p").lower()}.gpx'
            routes['apple_health_export' + rp] = route(st, dist, dur)
            xml.append(f' <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="{dur / 60:.4f}" durationUnit="min" sourceName="Apple Watch" sourceVersion="10.0" creationDate="{apple(en)}" startDate="{apple(st)}" endDate="{apple(en)}">')
            xml.append('  <MetadataEntry key="HKIndoorWorkout" value="0"/>')
            xml.append('  <MetadataEntry key="HKWeatherTemperature" value="61 degF"/>')
            xml.append(f'  <MetadataEntry key="HKElevationAscended" value="{int(1800 + wk * 300)} cm"/>')
            xml.append(f'  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" startDate="{apple(st)}" endDate="{apple(en)}" sum="{dist / 1.609344:.4f}" unit="mi"/>')
            xml.append(f'  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" startDate="{apple(st)}" endDate="{apple(en)}" sum="{dist * 62:.1f}" unit="Cal"/>')
            xml.append(f'  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" startDate="{apple(st)}" endDate="{apple(en)}" average="{hr:.1f}" minimum="{hr - 40:.1f}" maximum="{hr + 22:.1f}" unit="count/min"/>')
            xml.append(f'  <WorkoutRoute sourceName="Apple Watch" sourceVersion="10.0" creationDate="{apple(en)}" startDate="{apple(st)}" endDate="{apple(en)}">')
            xml.append(f'   <FileReference path="{rp}"/>')
            xml.append('  </WorkoutRoute>')
            xml.append(' </Workout>')
            # iPhone also logs the same session, with less detail (tests dedupe)
            xml.append(f' <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="{dur / 60:.4f}" durationUnit="min" sourceName="iPhone" sourceVersion="18.0" creationDate="{apple(en)}" startDate="{apple(st + timedelta(seconds=20))}" endDate="{apple(en)}">')
            xml.append(f'  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" startDate="{apple(st)}" endDate="{apple(en)}" sum="{dist * 0.97 / 1.609344:.4f}" unit="mi"/>')
            xml.append(' </Workout>')
        elif day.weekday() == 6 and random.random() < 0.7:
            dist = 3.5 + random.gauss(0, 0.6)
            dur = dist * 840
            st = day + timedelta(hours=9)
            en = st + timedelta(seconds=dur)
            xml.append(f' <Workout workoutActivityType="HKWorkoutActivityTypeWalking" duration="{dur / 60:.4f}" durationUnit="min" sourceName="Apple Watch" sourceVersion="10.0" creationDate="{apple(en)}" startDate="{apple(st)}" endDate="{apple(en)}">')
            xml.append(f'  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" startDate="{apple(st)}" endDate="{apple(en)}" sum="{dist / 1.609344:.4f}" unit="mi"/>')
            xml.append(f'  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" startDate="{apple(st)}" endDate="{apple(en)}" average="108.0" minimum="80.0" maximum="130.0" unit="count/min"/>')
            xml.append(' </Workout>')
    # one old-format self-closing workout and one indoor treadmill run
    old = plan_start - timedelta(days=10)
    xml.append(f' <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="21.5" durationUnit="min" totalDistance="1.52" totalDistanceUnit="mi" totalEnergyBurned="180" totalEnergyBurnedUnit="Cal" sourceName="Apple Watch" creationDate="{apple(old)}" startDate="{apple(old + timedelta(hours=18))}" endDate="{apple(old + timedelta(hours=18, minutes=21, seconds=30))}"/>')
    tm = plan_start + timedelta(days=15, hours=18)
    xml.append(f' <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="24.0" durationUnit="min" sourceName="Apple Watch" creationDate="{apple(tm)}" startDate="{apple(tm)}" endDate="{apple(tm + timedelta(minutes=24))}">')
    xml.append('  <MetadataEntry key="HKIndoorWorkout" value="1"/>')
    xml.append(f'  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" startDate="{apple(tm)}" endDate="{apple(tm)}" sum="1.9" unit="mi"/>')
    xml.append(' </Workout>')
    xml.append('</HealthData>')
    out = os.path.join(outdir, 'export.zip')
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('apple_health_export/export.xml', '\n'.join(xml))
        z.writestr('apple_health_export/export_cda.xml', '<ClinicalDocument/>')
        for name, gpx in routes.items():
            z.writestr(name, gpx)
    print(out, f'{len(xml):,} xml lines, {len(routes)} routes')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '.')
