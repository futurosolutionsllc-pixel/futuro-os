# Futuro OS

Two apps, one brand, one Supabase backend:

| Path | App | What it is |
|---|---|---|
| `/` (`index.html`) | **Futuro OS — Solo Edition** | The desktop command center: CRM, GovCon capture, contracts, intake, live jobs, load analyzer, quoting, billing. Supabase login + cloud snapshot persistence. |
| `/mobile/` | **Futuro OS — Mobile Ops** | The driver-side PWA for the road: day board, route optimization, live ETAs, drive mode, proof of delivery, customer texts, analytics. Same Supabase account; state syncs to its own `mobile_snapshot` table. |

The desktop sidebar links to Mobile Ops; the mobile Settings sheet links back to desktop.

**Website funnel:** `integrations/` holds drop-in inquiry forms for futurosolutions.net
and futurotransport.com that post straight into the shared Supabase — inquiries appear
in the desktop Portal Inbox and the mobile Biz → Website inbox. See `integrations/README.md`.

## Running it

Both apps are static — no build step, no server code.

- **Locally:** `python3 -m http.server 8000` in the repo root; open `http://localhost:8000`
  (desktop) or `http://localhost:8000/mobile/` (mobile).
- **Hosted:** serve the repo from any static host (Netlify/GitHub Pages). Must be HTTPS
  for GPS, camera, and install-to-home-screen to work.
- **On your phone:** open `/mobile/`, then "Add to Home Screen." It runs full-screen and
  keeps working offline (map tiles, address lookup, and cloud sync need a connection;
  everything else doesn't).

## Cloud sync (shared Supabase backend)

Both apps sign into the same Supabase project with the same email/password account.
Each app persists to its own one-row-per-user table so they can never overwrite each
other: desktop → `snapshot`, mobile → `mobile_snapshot` (owner-scoped RLS on both).
The mobile app works fully offline/logged-out; signing in (Settings → Cloud sync) adds
debounced cloud backup and carries your jobs across devices. Last writer wins by
`savedAt` timestamp on load.

# Futuro OS — Mobile Ops (`/mobile/`)

A delivery operations app for a **solo owner/operator** — the dispatcher, the driver,
and the back office are the same person, working from one mobile app that can be used
one-handed between stops.

It covers the operational core of a commercial last-mile platform (dispatch board, route
optimization, live ETAs, driver workflow, proof of delivery, customer texts, analytics,
data export/webhooks) rebuilt around one person instead of a fleet, plus a compact
business pipeline (freight deals + live SAM.gov GovCon sourcing).

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
  Kelly-green gradient primaries with glow, Syne body + JetBrains Mono micro-labels,
  Tabler icons, and the soundwave f-clef logo lockup (`icons/mark.svg` is the monogram,
  also used for the PWA icon).
- **Storage:** everything in `localStorage` under `fos.*` keys (`fos.jobs`, `fos.settings`,
  `fos.track.<date>` GPS breadcrumbs; legacy `deals` key is kept for pipeline data).
  POD photos are downscaled (≤900px JPEG, max 3/job) to respect the ~5MB quota; use
  the JSON backup regularly.
- **External services (all free, all optional):** Nominatim (geocoding), OSRM demo
  server (road routing/optimization), OpenStreetMap tiles, SAM.gov API. Every one has
  an offline/failure fallback — the app never blocks on the network.

## What deliberately stays out (single-user scope)

- Customer-facing live tracking pages and automated (non-interactive) SMS require a
  server + telephony provider (Supabase Edge Functions + Twilio are the natural fit,
  since auth and storage are already on Supabase). The webhook + JSON export are the
  integration points to add that without changing the app's data model.
- Multi-driver dispatch is out of scope by design.

## Safety

Drive mode is built for interaction **while stopped**: oversized touch targets, one
advancing action per stop, and handoff to your phone's native voice-guided navigation
app for the actual driving.
