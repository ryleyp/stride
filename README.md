# Stride

A 5K training companion that runs entirely in your browser. It pulls your Apple Watch and iPhone workouts out of an Apple Health export and puts them next to a live GPS trail tracker, a pedometer, a run/walk interval coach and a 9-week plan that ends on race day. Nothing is uploaded anywhere; every byte stays in the browser's own storage on the device you use it on.

## What's inside

| Tab | What it does |
|---|---|
| **Home** | Race-day countdown, predicted 5K time (your fastest 5K, or a Riegel projection from your best recent run), goal pace, this week vs last week, longest run, steps today, weekly distance chart, recent activity, VO2 max and resting heart rate trends, pace trend with your goal pace as a reference line. |
| **Runs** | Every imported workout plus anything Stride recorded. Open one for the route map, splits per mile/km, heart rate (with zone when you've set your age or max HR), calories, elevation, temperature and a GPX export. |
| **Track** | Live GPS tracker: elapsed time, distance, current and average pace, elevation gain, map with your trail. Pick a coach session and you get a voice cue plus beeps at every run/walk switch. "Coach only" runs the cues without GPS for a treadmill. Saving a run checks off that day's plan session. |
| **Steps** | Live pedometer from the phone's motion sensor (cadence too), today's progress toward your goal, last 30 days of Apple Health steps, 7-day average, best day, days at goal. |
| **Plan** | 9 weeks, three sessions a week, from 1-minute jogs to a 30-minute run. Sessions check themselves off when a run lands on that date; tap the circle to override. Tap a session to start it with the coach. |
| **Settings** | Import, race date, goal time, plan start, units (mi/km), appearance, step goal, stride length, age/max HR (shows your zones), JSON backup, erase. |

## Getting your Apple workouts in

1. On the iPhone open **Health**, tap your picture, scroll to **Export All Health Data**, tap Export, then **Save to Files**. You get `export.zip`. Big libraries take a few minutes and can be a gigabyte; that's normal.
2. Open Stride, go to Settings, tap the import box and pick `export.zip`. Stride streams the zip in place and keeps only workouts, workout routes, daily steps, walking/running distance, exercise minutes, resting heart rate and VO2 max.
3. Re-import whenever you like. Workouts are matched by start time and type, so nothing duplicates. If both the Watch and the iPhone logged the same session, the richer one (route, heart rate) wins. Daily steps take the higher of the two sources, which is how the Health app itself avoids double counting.

Faster on a Mac for very large exports:

```bash
python3 tools/convert_export.py ~/Downloads/export.zip -o health.json
```

Then import `health.json` (usually a megabyte or two, imports in a second). The converter also accepts the unzipped `apple_health_export` folder.

Want to see it with data before you export? Settings has a **Load demo data** button (clearly marked, replaces nothing until you import for real). `sample/export.zip` is that same fake export in Apple's format if you want to test the zip path.

## Running it

It is a static site, so any web server works. On the Mac:

```bash
cd ~/Documents/Claude\ Code/stride && python3 -m http.server 8790
```

Then open http://localhost:8790. (Opening `index.html` straight from Finder won't work: the app uses JavaScript modules, which browsers refuse over `file://`.)

### Putting it on your iPhone

GPS tracking and the pedometer only work on pages served over **HTTPS** (or localhost). A plain `http://your-mac-ip:8790` over Wi-Fi will show everything except those two. Two easy ways to get HTTPS for free:

- **GitHub Pages.** Push this folder to a GitHub repo and enable Pages for the main branch root. The site lands at `https://<you>.github.io/<repo>/`. With the `gh` CLI, from inside this folder:

  ```bash
  git init && git add -A && git commit -m "Stride" && gh repo create stride --public --source=. --push && gh api -X POST repos/{owner}/stride/pages -f 'source[branch]=main' -f 'source[path]=/'
  ```

  The repo only holds the app's code, never your health data (that stays in the phone's browser storage), so a public repo is fine. Delete `sample/` first if you'd rather not publish the demo files.

- **Netlify Drop.** Go to https://app.netlify.com/drop and drag the `stride` folder onto the page. You get an HTTPS URL in seconds.

Once it's up, open the URL in Safari on the iPhone, tap Share, then **Add to Home Screen**. It launches full-screen, caches itself for offline use, and remembers your data between launches.

### Things to know on the phone

- Keep Stride in the foreground with the screen on while tracking a run. iOS stops sending location to web pages when the screen locks. Stride asks for a screen wake lock, which Safari honors while the page is visible.
- The pedometer counts only while Stride is open. Your Apple Health import is always the complete record; the live counter is for the moment, and it shows cadence (aim for 170 to 180 steps per minute when running).
- The first time you start the pedometer, iOS asks for motion access. If you declined once, turn it on under Settings › Safari › Motion & Orientation Access.
- Voice cues use the phone's speech engine. Turn the ringer on, or wear headphones; the switch also vibrates on Android.

## Files

```
index.html            app shell
css/app.css           design tokens (light + dark), layout, components
js/app.js             router and every view
js/health-import.js   streaming Apple Health export parser (zip, xml, gpx, json)
js/store.js           in-memory state backed by IndexedDB
js/tracker.js         GPS tracker + interval coach
js/pedometer.js       motion-sensor step counter
js/plan.js            the 9-week plan and session helpers
js/charts.js          hand-drawn SVG bar/line charts with tooltips
js/vendor/fflate      MIT-licensed zip streaming library
tools/convert_export.py   Mac-side converter: export.zip -> health.json
tools/make_sample.py      generates a fake export.zip for testing
sample/               demo data
sw.js                 offline cache for the app shell
```

Map tiles come from OpenStreetMap; the Leaflet map library and the Barlow typeface load from CDNs. Everything else ships with the app.
