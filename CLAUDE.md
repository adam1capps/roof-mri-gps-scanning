# Roof MRI — project context

## Company

- The company is **ReDry** — one word, capital R capital D, **no hyphen**.
  Never write "Re-Dry" or "Re-dry" in prose, UI copy, docs, or store metadata.
- The **domain/email keeps its hyphen**: `re-dry.com`, `adam@re-dry.com`,
  `reports@re-dry.com` — those are the real addresses; do not "fix" them.
- iOS/Android bundle id: `com.redry.roofmri` (no hyphen, lowercase).

## Apple Developer account (enrolled July 2026)

- Organization: legal entity **ReDry LLC** · Team ID **BWBGQ29B36** ·
  Account Holder Adam Capps (adam@re-dry.com) · renews 2027-07-07.
- App Store Connect: app record **"Roof MRI"** exists (bundle
  `com.redry.roofmri`, SKU `roofmri-001`); EU DSA trader declaration done;
  Free Apps Agreement active (Paid Apps unsigned — not needed for TestFlight).
- TestFlight plan: internal group **"ReDry Field Crew"** (created after the
  first Xcode build upload).

## What this app is

2D flat-roof **moisture mapping**: an Emlid Reach RX2 RTK rover screwed on top
of a **Tramex RWS** moisture scanner. The RX2 sits directly over the sensing
area — **no tilt compensation in normal operation** (tilt mode "Level", or tilt
off on the receiver). Readings are Tramex values **0–10** (0 = surveyed dry;
unscanned = assumed dry), entered by sunlight keypad or voice ("mark seven"),
pinned precisely or attributed to 10×10 ft grid squares, rendered over Google
satellite tiles, and finalized into a report request for the ReDry
**Roof MRI Report Creation Team** (webhook + share-sheet package).

## Engineering invariants (do not regress)

- Points/readings record **only at RTK FIX** (GGA quality 4), gated on combined
  2D accuracy: GST σH (+ tilt term only when this app applies compensation).
- GGA/ETC stream at **5 Hz, GST at 1 Hz** — the epoch assembler carries GST
  forward (≤2 s). Verified against the official RX2 NMEA spec.
- If Emlid Flow's "NMEA message compensation" is ON, the receiver outputs
  already-compensated positions → tilt mode must be **receiver-compensated**
  (never double-compensate).
- Area/perimeter math on a **local tangent plane at roof height** — never
  Web Mercator, raw lat/lon, or UTM (UTM only for georeferenced DXF export).
- Google Map Tiles policy: tiles load live only (no offline cache), imagery is
  visualization-only, attribution stays visible.
- Core (`src/core/`) stays pure TypeScript with no React Native imports, fully
  unit-tested (`npm test`), and `npm run typecheck` stays clean.

## Release checklist pointers

- Field acceptance: `docs/FIELD_CHECK.md` (run before deploying a rig).
- Before iOS App Store submission: email developers@emlid.com with bundle id
  `com.redry.roofmri` for MFi whitelisting; include the Emlid PPID in metadata.
- Google Maps API key lives in app Settings (user-entered), never in the repo.
