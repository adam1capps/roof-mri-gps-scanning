# Roof MRI — GPS Scanning

2D flat-roof measurement app for the **Emlid Reach RX2** RTK rover (React Native, iOS + Android).

Walk the roof, tap corners, get survey-grade perimeters, penetrations and areas — rendered live
over Google satellite imagery and exported to CSV / GeoJSON / DXF / SHP.

```
RX2 ──BT──▶ NMEA parser ──▶ epoch assembler ──▶ fix gate ──▶ capture ──▶ map overlay
 ▲   (GGA/GST/ETC @5Hz)      (match by time)   (RTK FIX +      │        (Google satellite)
 │                                              σ + tilt 30)   ▼
 └──RTCM3◀── NTRIP client ◀──GGA upstream── caster    area/perimeter → CSV/GeoJSON/DXF/SHP
```

## How measurement works (the part that matters)

- **Only RTK FIX epochs are recordable** (GGA quality 4). FLOAT/SINGLE are shown but never saved.
- **Message rates** (per the official RX2 NMEA spec): GGA and ETC stream at **5 Hz**, GST (and
  GSA/GSV/RMC/VTG/ZDA) at **1 Hz**. The epoch assembler matches sentences by UTC timestamp and
  carries the latest GST forward (max 2 s) so every 5 Hz fix gets an accuracy estimate.
- **Per-point accuracy** comes from GST: σH = √(σlat² + σlon²). When this app applies tilt
  compensation, the ETC per-axis coefficients × antenna height are added (Emlid ETC doc rev.3
  formulas). The combined 2D accuracy is gated against a configurable limit (default 3 cm) and
  stored per vertex.
- **Tilt compensation is applied in-app** (default): the RX2's GGA reports the *antenna*
  position; the ETC message (state 30 = compensating) supplies heading/tilt direction/tilt
  value, and the app computes the pole-tip position via the local-tangent-plane deltas from the
  Emlid spec. Antenna height = pole height + **0.145 m** (RX2 bottom→ARP).
- **⚠ Double-compensation trap**: Emlid Flow has an *"NMEA message compensation"* option
  (Integration with external software). When it is ON, the receiver itself outputs the
  compensated pole-tip position — set the app's tilt mode to **Receiver compensated** so the
  offset isn't applied twice. When it is OFF (default), use **Auto** or **Require**. The other
  modes are level-pole (raw antenna position) and auto (compensate when state 30, pass through
  when tilt is off).
- **Epoch averaging**: each tap averages N consecutive accepted epochs (default 5 = 1 s @ 5 Hz).
- **All area/perimeter math happens on a local East-North tangent plane in meters**, evaluated at
  the roof's ellipsoidal height — not on Web Mercator, not on raw lat/lon, and not in UTM (which
  distorts up to 400 ppm). At roof scale the tangent plane is exact to well below RTK noise.
- **Snap-to-close**: with ≥3 corners down, tapping within the snap radius (default 25 cm) of the
  first corner closes the polygon.
- Net area = Σ perimeter polygons − Σ penetration polygons. Shown in ft², roofing squares, or m².

## Feature types

| Type        | Geometry        | Use for                                   |
|-------------|-----------------|-------------------------------------------|
| Perimeter   | closed polygon  | roof sections (adds area)                 |
| Penetration | closed polygon  | HVAC curbs, skylights (subtracts area)    |
| Edge        | open polyline   | parapets, expansion joints, transitions   |
| Point       | single point    | drains, pipe boots, scuppers              |

## Hardware setup (field checklist)

1. **Pair the RX2** in the phone's Bluetooth settings (Android; iOS discovers MFi accessories automatically).
2. In the app: **Receiver tab → select the RX2 → Connect.** NMEA starts streaming at 5 Hz.
3. **Corrections**, either:
   - **Emlid Flow** (free) running in the background feeding RTCM3 to the RX2, or
   - **In-app NTRIP**: enter caster/port/mountpoint/credentials → Connect. RTCM3 is forwarded
     to the RX2 over Bluetooth and your GGA is sent upstream every 10 s (required for VRS
     networks). "Browse mount points" fetches the caster source table.
4. Wait for **RTK FIX** (green) and tilt state **Compensating** if using tilt.
5. Walk the roof and tap **Capture point** at each corner.

## Exports

- **CSV** — one row per vertex: lat/lon (9 dp), σH, total 2D accuracy, fix, tilt, epochs, timestamps.
- **GeoJSON** — RFC 7946 (WGS84), per-feature and project-level area/perimeter properties.
- **DXF** — R12 ASCII, layers PERIMETER/PENETRATION/EDGE/POINTS. Coordinates either
  *local site meters/feet* (clean CAD takeoff numbers) or *UTM georeferenced* (EPSG noted in a
  header comment).
- **Shapefile** — .shp/.shx/.dbf/.prj (WGS84), split into `*_polygons`, `*_lines`, `*_points`,
  written by a dependency-free binary writer.

Files land in the app's documents folder and are offered through the native share sheet.

## Google Map Tiles API (aerial basemap)

Setup: Google Cloud Console → create project → enable **Map Tiles API** → create an API key
(restrict it to Map Tiles API + your app) → paste it in **Settings**.

The app implements the session-token flow (`POST /v1/createSession`, `mapType: satellite`) and
renders `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}` as a MapLibre raster source
(max zoom 22). Without a key it falls back to OpenStreetMap raster tiles so you can work.

**Policy constraints, implemented deliberately — do not "optimize" them away:**
- **No offline tile caching.** Tiles load live; MapLibre's persistent ambient cache is set to 0
  at startup. Only vector survey data is persisted.
- **Imagery is visualization only.** No pixel analysis/feature extraction — every measurement
  comes from the RX2.
- **Attribution** (viewport-endpoint copyright string + Google logo) is displayed bottom-right
  above the controls. Before store release, replace the text wordmark in
  `CaptureScreen` with the official logo asset per Google's brand guidelines.

## Building

```bash
npm install
npm test              # 80 unit tests over the core (NMEA/geo/gate/NTRIP/export/tiles)
npm run typecheck

# Android
npm run android       # device with the RX2 paired

# iOS
cd ios && pod install && cd ..
npm run ios
```

Native config already in place: Android `BLUETOOTH_CONNECT/SCAN` (+ legacy) permissions;
iOS `UISupportedExternalAccessoryProtocols` = `com.emlid.nmea`, `com.emlid.corrections`,
Bluetooth/location usage strings, `external-accessory` background mode.
Bundle/application id: `com.redry.roofmri`.

### App Store (iOS) — before release
Email **developers@emlid.com** with the bundle ID (`com.redry.roofmri`) for MFi accessory
whitelisting, and include the Emlid-provided accessory PPID in App Store Connect metadata.

## Code map

```
src/core/            pure TypeScript, no React Native imports — fully unit tested
  nmea/              checksum, GGA/GST/ETC(rev.3)/GSA/GSV parsers, stream framing, epoch assembly
  geo/               WGS84/ECEF/ENU transforms, tilt compensation, tangent-plane measure, UTM
  gnss/              fix gate (RTK FIX + σ + tilt policy), epoch averager
  capture/           project/feature model, session ops (add/undo/snap-close), stats
  ntrip/             NTRIP v1/v2 state machine, sourcetable, RTCM3 splitter (CRC24Q)
  export/            CSV, GeoJSON, DXF R12, binary SHP/SHX/DBF/PRJ writers
  tiles/             Google Map Tiles session/viewport/attribution, MapLibre style builder
src/device/          react-native-bluetooth-classic link (SPP + iOS EA), TCP NTRIP transport
src/app/             GnssController — wires BT → parser → gate → store, NTRIP → RX2
src/state/           zustand store (settings, projects, live status)
src/services/        persistence (RNFS JSON), exporter + share, tile session manager
src/ui/              screens (Projects/Capture/Connect/Settings/Export), map overlays, theme
```

### Verified against
- Emlid **ETC NMEA message doc rev.3** (RX2): field layout, state machine, compensation and
  accuracy formulas (test vectors match the published `$GNETC…*5E` example).
- Reach RX2 datasheet: BT 4.2 BR/EDR, NMEA out / RTCM3-NTRIP in, 5 Hz, MFi.

### Known deferred items
- iOS External Accessory protocol handling (`protocolString` on connect) needs on-device
  validation with a physical RX2 — Android SPP is the straightforward path.
- Battery/antenna status display, multi-section roofs with shared walls, and GeoTIFF/drone
  orthomosaic import (option 2 of the imagery spec) are future work.
