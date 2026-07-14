# FuturoOS Operator

A delivery operations platform for a **solo owner/operator** — the dispatcher, the driver,
and the back office are the same person, working from one mobile app that can be used
one-handed between stops.

It covers the operational core of a commercial last-mile platform (dispatch board, route
optimization, live ETAs, driver workflow, proof of delivery, customer texts, analytics,
data export/webhooks) rebuilt around one person instead of a fleet, plus the original
FuturoOS business pipeline (freight deals + live SAM.gov GovCon sourcing).

## Running it

It's a static PWA — no build step, no server.

- **Locally:** `python3 -m http.server 8000` in the repo root, open `http://localhost:8000`.
- **Hosted:** serve the repo from any static host (GitHub Pages works). Must be HTTPS
  for GPS, camera, and install-to-home-screen to work.
- **On your phone:** open the URL, then "Add to Home Screen." It runs full-screen and
  keeps working offline (map tiles and address lookup need a connection; everything else doesn't).

## The modules

| Area | What it does |
|---|---|
| **Today** | Day board: stops in route order with status, time window, live ETA and on-time/late flag; earned-so-far summary; date navigation. |
| **Optimize** | One tap sequences all open stops. Uses OSRM road distances/times when online (with the route drawn on the map), haversine estimates offline. Nearest-neighbor + 2-opt, with lateness against time windows penalized. |
| **Drive** | Full-screen current stop with huge buttons: Navigate (Google/Waze/Apple), Call, Text ETA, Text arrived, and one advancing action (Start → Arrived → Proof of delivery). Shows the next stop; auto-advances through the day. |
| **Proof of delivery** | Photos (camera, auto-compressed), finger signature, barcode scan (camera `BarcodeDetector` where supported, typed entry everywhere), notes, geo+timestamp. Required-barcode enforcement per job. Failed-attempt flow with reason. |
| **Customer texts** | Template-based SMS ("on my way" with computed ETA, "arrived", "delivered") sent through your own phone's messenger — zero per-message cost. Templates support `{name} {company} {eta} {address}`. |
| **Map** | All stops numbered on an OpenStreetMap map, optimized route polyline, your live position. |
| **Stats** | Computed from real completed jobs: completed/failed, on-time rate (vs. time windows), revenue, $/mile, miles driven (from GPS breadcrumbs), average stop time, deliveries & revenue per day charts, top customers. |
| **Jobs** | Full job list + editor: type (delivery/pickup), customer, phone, address (geocoded via Nominatim, or enter `lat,lng` directly), date, time window, rate, required barcode, notes. |
| **Biz** | The original pipeline (Lead → Active → Closed), freight deals, live SAM.gov opportunity sourcing. Won deals convert to jobs in one tap. |
| **Data** | JSON backup/restore, jobs CSV export, and an optional webhook URL that receives a POST on every job completion/failure. |

## Architecture

- **Stack:** vanilla JS + Leaflet (vendored in `vendor/leaflet/`, no CDN). `index.html`,
  `styles.css`, `app.js`, `sw.js` (offline shell cache), `manifest.webmanifest`.
- **Design language:** same system as Futuro OS Solo Edition — navy glass panels,
  Kelly-green gradient primaries with glow, Jost body + JetBrains Mono micro-labels,
  Tabler icons, and the soundwave f-clef monogram (`icons/mark.svg`, also the PWA icon).
- **Storage:** everything in `localStorage` under `fos.*` keys (`fos.jobs`, `fos.settings`,
  `fos.track.<date>` GPS breadcrumbs; legacy `deals` key is kept for pipeline data).
  POD photos are downscaled (≤900px JPEG, max 3/job) to respect the ~5MB quota; use
  the JSON backup regularly.
- **External services (all free, all optional):** Nominatim (geocoding), OSRM demo
  server (road routing/optimization), OpenStreetMap tiles, SAM.gov API. Every one has
  an offline/failure fallback — the app never blocks on the network.

## What deliberately stays out (single-user scope)

- No accounts/auth, no backend — one operator, one phone, local data.
- Customer-facing live tracking pages and automated (non-interactive) SMS require a
  server + telephony provider (e.g. Supabase + Twilio). The webhook + JSON export are
  the integration points to add that later without changing the app's data model.
- Multi-driver dispatch is out of scope by design.

## Safety

Drive mode is built for interaction **while stopped**: oversized touch targets, one
advancing action per stop, and handoff to your phone's native voice-guided navigation
app for the actual driving.
