# Roof MRI — Field Acceptance Check

Run this once per app release (and once per new phone model) **on a parking lot before
anyone climbs a roof**. Total time: ~45 minutes with the RX2 mounted on the Tramex RWS.

You need: the RWS + RX2 rig, a charged phone with the app, a corrections source
(Emlid Flow account or NTRIP credentials), a 25 ft tape measure, sidewalk chalk,
and work gloves (test with the gloves you actually wear).

Print this page. Check every box. If any **FAIL** box gets ticked, stop and report it —
do not take the rig to a job until it's resolved.

Tester: ______________________ Date: ____________ Phone model: ______________________

App version: ____________ RX2 firmware: ____________ Corrections: ☐ Emlid Flow ☐ NTRIP

---

## 1. RTK basics (5 min)

Power the RX2, pair it, connect in the app (Receiver tab), start corrections.

- ☐ RX2 appears in the device list and connects on the first try
- ☐ Status bar shows live data (Fix / σH / Sats update ~5×/second)
- ☐ RTCM shows **live** (corrections flowing)
- ☐ RTK FIX reached within 60 s of corrections starting (typical: 5–30 s)
- ☐ σH settles at ≤ 2 cm with open sky
- ☐ **FAIL**: no FIX after 5 min, or FIX drops repeatedly while standing still

> If this section fails, everything else will too. Check the mount point / corrections
> account first, then satellite view (open sky?), then reboot the RX2.

## 2. Repeatability (5 min)

Pick one crisp physical spot (paint line corner). In Layout mode, capture a **Point**
feature on it. Wait one minute. Capture it again. Repeat once more.

- ☐ All three dots land within a ~3 cm circle of each other on the map
- ☐ Each capture completes in ~1 s (5-epoch average) with no error banner
- ☐ **FAIL**: spread > 10 cm at RTK FIX — report immediately (something is wrong in the chain)

## 3. Known-dimension check (10 min)

Tape-measure a rectangle on the lot (a block of parking stalls works — aim for at least
20 × 10 ft). Write down the taped sides. Trace it as a **Perimeter** (4 corners,
snap-to-close on the 5th tap at the first corner).

Taped: _______ ft × _______ ft → area _______ ft²

App:   net area _______ ft² · perimeter _______ ft

- ☐ Snap-to-close triggered when tapping near the first corner (no duplicate 5th corner)
- ☐ Each app side matches tape within ±1 inch
- ☐ App area within ±1% of taped area
- ☐ **FAIL**: any side off by > 3 inches at RTK FIX

## 4. Imagery offset check (5 min) — READ THIS ONE

Stand on a feature you can see crisply in the satellite photo (manhole, paint
intersection). Capture a point.

- ☐ Dot lands on/near the feature in the imagery
- ☐ If the dot is offset: measure roughly how far: _______ ft, direction: _______

**An offset up to ~1–3 ft is NORMAL and is the imagery's fault, not the GPS.**
Satellite basemaps are not perfectly georeferenced. Your measurements (areas, distances,
wet squares) are RTK-accurate regardless — the photo underneath may simply be shifted.
Everyone using the app must know this so nobody "corrects" good data to match a shifted
photo. (A same-day drone orthomosaic eliminates the offset; future capability.)

- ☐ **FAIL**: offset > 10 ft (likely a real problem — wrong fix type or imagery mismatch)

## 5. Grid alignment vs. chalk (10 min)

Chalk two perpendicular lines ~20 ft long (a corner), like your manual grid.

**Calibrate:** Scan mode → Grid → *Calibrate: mark grid origin* while standing on the
chalk corner → walk ~20 ft down one chalk line → tap *Grid: mark row →*.

- ☐ "Grid calibrated" confirmation appears
- ☐ Switch to cell mode (10×10 ft square): take a reading standing ~6 in on ONE side of
  the chalk line, then another ~6 in on the OTHER side
- ☐ The two readings color **different, adjacent** squares (cell edges align with chalk)
- ☐ Re-read one square with a different value — the square updates (does not duplicate)

**Instant grid:** trace and close a rectangle in Layout mode → Grid → *Instant grid*.

- ☐ Grid squares run parallel to the rectangle's long edge
- ☐ **FAIL**: a reading 6 in from a chalk line lands in the wrong square after calibration

## 6. Scan workflow under realistic conditions (10 min)

Roll the RWS at working pace and log readings on the move.

**Keypad** (wear your gloves):

- ☐ Keys are hittable with gloves at walking pace
- ☐ Reading confirmation flashes ("7 recorded") and the dot/square appears where you
  **were** when you tapped (not where you are 2 s later)
- ☐ With corrections OFF (disconnect NTRIP/Flow briefly): keypad shows a clear rejection
  (e.g. "Not RTK FIX") and records nothing — then reconnect
- ☐ Undo removes the last reading from the map

**Voice** (test near a running vehicle or in wind if possible):

Say the command 10 times at normal volume: "mark ____" with different numbers.

Recognized correctly: _____ / 10

- ☐ ≥ 8/10 recognized in calm air (≥ 6/10 in wind is acceptable; note it)
- ☐ Wrong/no fix is spoken back in the status chip (✕ + reason), not silently dropped
- ☐ Android: note the session beep frequency — annoying? ☐ yes ☐ tolerable
- ☐ **FAIL**: recognized value ≠ spoken value (a MIS-heard number that records wrongly
  is worse than a miss — report which numbers confused it: ____________)

## 7. Summary & report package (5 min)

Tap **Finish scan**.

- ☐ Duration and readings/hr look plausible for what you just did
- ☐ Wet-square count matches the squares you actually marked; ft² = squares × 100
- ☐ Distribution bars match the values you entered
- ☐ Take one roof photo and one core-sample photo — both appear (CORE tag on the sample)
- ☐ Add a note, tap **Submit report request**, share the package to yourself
- ☐ On a desktop: manifest JSON opens and is readable; the `.geojson` loads at
  geojson.io with cells colored correctly; photos are intact

## 8. Practicalities (observe throughout)

- ☐ Screen readable in direct sunlight at arm's length
- ☐ Phone battery used over the session: _______ % (flag if > 25%/hour)
- ☐ Bluetooth held solid with the phone at working distance from the rig
- ☐ App survived being backgrounded/locked mid-scan without losing readings

---

## Result

☐ **PASS — cleared for roof work**  ☐ **FAIL — report filed, do not deploy**

Notes / quirks observed:

&nbsp;

&nbsp;
