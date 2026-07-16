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
debounced cloud backup and carries your jobs across devices.

### Desktop storage and sync rules

**Local cache is per account.** The desktop cache key is `futurofreight_v1:<user-id>`,
derived from the authenticated Supabase user ID and resolved at the moment of each read
or write. Nothing is read from or written to local storage until authentication has
resolved, so one account can never load or overwrite another's cache — even in the same
browser.

**Cloud load has three distinct outcomes**, and an error is never mistaken for "no data":

| Outcome | Meaning | What the app does |
|---|---|---|
| `CLOUD_ROW_LOADED` | A valid snapshot came back | Compare it against the local cache and load the newer one |
| `CLOUD_ROW_ABSENT` | Positively confirmed: no row for this account | Load local if present, otherwise start a new account and create the first cloud row **once** |
| `CLOUD_LOAD_ERROR` | Request failed, or the cloud snapshot is malformed | **Block all cloud writes.** Never initialize, never upsert |

**The `savedAt` conflict rule.** `savedAt` is a millisecond timestamp written into every
snapshot. On load, the valid cloud and local timestamps are compared and the **newer one
wins** — so work done offline is never overwritten by an older cloud copy. A snapshot with
a missing or invalid timestamp is treated as older than any validly timestamped one and
can never defeat it. **Exact ties go to the cloud**, deterministically: the local cache is
written from the cloud on load, so equal timestamps almost always mean identical content,
and preferring the cloud keeps multiple devices converging.

**Offline / local-only.** If the cloud can't be verified but a valid local cache exists,
the app loads it and keeps working — edits still save locally, the save chip reads
*"Cloud unavailable · working locally"*, and cloud writes stay blocked until a successful
retry. If the cloud can't be verified **and** there's no local cache, editing is paused
rather than showing you an empty app that looks like a new account: nothing has been lost,
and a Retry button re-checks. The sidebar and sign-out stay available throughout.

**Logout keeps your offline data.** Signing out normally cancels any pending save, clears
the in-memory CRM, and signs out of Supabase — but **keeps** this account's local cache, so
unsynced work survives and reappears at the next sign-in. To remove it deliberately, use
**Settings → Sign out and remove offline data**, which warns first and only ever removes the
signed-in account's own cache.

**Recovering data from an older version.** Versions before per-account caching stored data
under a single shared `futurofreight_v1` key. That key is never read automatically, never
deleted, and never uploaded.

If you sign in with no cloud row and no cache for your account, a notice offers to import
earlier browser data, and the same action appears at **Settings → Recover earlier browser
data**.

Recovery is offered only when the account has no data of its own and its cloud record was
positively confirmed empty. Outside that state, the recovery action is unavailable, because
importing would replace current account data.

The app *cannot* prove that the earlier browser data belongs to the account currently signed
in. Import therefore requires an explicit warning and confirmation, may synchronize the
imported data to that account's cloud record, and leaves the original legacy browser copy
unchanged.

If your local cache ever becomes unreadable, the raw value is preserved byte-for-byte under
`futurofreight_v1:recovery:<user-id>:<timestamp>` (up to 3 copies per account) rather than
being deleted, and the app carries on from the cloud copy.

### Imported data is treated as untrusted

CSV lead import (**Import CSV** on the Leads page) and the public website inbound funnel can
carry arbitrary text. Imported values are stored as the user's original text — never
HTML-encoded at rest — and are escaped at every render sink via `esc()`, so a value like
`<img src=x onerror=…>` is shown as inert text and never executes. No imported value is turned
into a clickable link or an event-handler attribute; the `tel:`/`mailto:` actions use fixed
schemes only. Persistent-XSS regression coverage lives outside this repo at
`../FuturoFreight_Test_Harnesses/p0b-harness.html`.

### Tests

The regression harness for the rules above lives **outside this repository**, at
`../FuturoFreight_Test_Harnesses/p0a-harness.html`. It is kept out of the repo on purpose:
this repo is deployed as a static site straight from its root, so anything committed here
is published, and a test page has no business being served in production.

To run it, serve the **parent** directory (so the harness and the app share one origin) and
open the harness:

```
cd ..                       # the directory holding FuturoFreight/ and FuturoFreight_Test_Harnesses/
python3 -m http.server 8000
# → http://localhost:8000/FuturoFreight_Test_Harnesses/p0a-harness.html
```

It drives the real `index.html` in an iframe against a mocked Supabase client — `createClient`
is replaced before the app's inline script runs, so no request to a live project is ever
constructed. It refuses to run anywhere but localhost, and backs up and restores any existing
`futurofreight_v1` key so a real cache is never disturbed.

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
- **Storage:** durable, account-scoped state (jobs + deals + settings) lives in a single
  snapshot per account under `fos.acct.<scope>` in `localStorage`, mirrored to an
  IndexedDB durability tier (see *Mobile offline durability* below). `fos.track.<date>`
  GPS breadcrumbs and device-level keys (`fos.pinHash`, `fos.lockMins`, …) stay separate.
  POD photos are downscaled (≤900px JPEG, max 3/job) to respect the ~5MB quota; use
  the JSON backup regularly.

## Mobile offline durability

The mobile CRM must never silently discard valid offline work, show an empty CRM while
good local data exists, or upload stale/default state over a newer cloud copy. The rules,
implemented entirely in `mobile/app.js` (the centralized `Store` layer):

**Per-account scope.** All durable state is keyed by scope: the authenticated Supabase
user id when signed in, or `local` while signed out. Two accounts on one phone can never
read or overwrite each other's work — the same isolation contract as the desktop
per-account cache (`_authEpoch` / capture-and-recheck around every `await`). On sign-out
the app returns to the anonymous scope; the signed-in account's cache is **kept** for the
next sign-in, not shown to the anonymous session.

**Two durability tiers.** `localStorage` is the fast, synchronous live store the UI reads;
per-key writes are atomic (a key is fully replaced or left unchanged — never half-written).
IndexedDB (`futuroos-mobile` → `snapshots`) is a second, eviction-resistant tier that keeps
a **last-known-good** copy. A corrupt or unreadable current snapshot can no longer throw at
load and blank the app: it is preserved byte-for-byte under `fos.acct.<scope>.recovery.<ts>`
(max 3 per scope, never overwritten, never uploaded), and the app falls back to the
last-known-good snapshot, then to the IndexedDB tier.

**Serialized, coalesced writes.** Durable writes run on one queue that keeps only the newest
snapshot, so a slow older write can never replace a newer one. A failed local write returns
`ok:false`; the app warns and never reports "saved".

**Lifecycle durability.** On `visibilitychange`→hidden, `pagehide`, and `freeze`, the latest
in-memory snapshot is forced to durable local storage first (synchronous), then any pending
cloud write is flushed — guarded so nothing is written under a signed-out/other account.

**Reconnection & the `savedAt` rule.** Cloud load has three distinct outcomes and an error is
never mistaken for "no data": a `CLOUD_LOAD_ERROR` blocks writes and keeps local data;
`CLOUD_ROW_ABSENT` (positively confirmed) or a strictly-newer local snapshot uploads once;
a strictly-newer cloud snapshot is applied once (and its `savedAt` is preserved locally so no
upload loop follows). **Exact `savedAt` ties resolve to the local device** (deterministic):
it re-uploads the same stamp a single time and converges — this differs from the desktop
snapshot (cloud wins ties) because mobile jobs are the authoritative shared `jobs` table and
`mobile_snapshot` carries only deals + settings. A snapshot we cannot trust (corrupt/
unrecovered) is never uploaded over the cloud.

**Storage failure.** Quota/security/IndexedDB-unavailable failures degrade safely: current
in-memory work is preserved, the failure is surfaced (never a false "saved"), and on POD
completion the heavy photos are dropped before the delivery record itself is lost.

**Service-worker boundary.** P0-C itself changes no service-worker code; it is the
data-durability layer. The service-worker *update* safety that used to reload mid-edit is
handled separately by **Controlled PWA updates (P0-D)** below, which calls this same P0-C
durability flush before it ever activates a new build. P0-D does not add a second save
system — mobile durability remains this layer.

Regression coverage lives outside this repo at
`../FuturoFreight_Test_Harnesses/p0c-harness.html` (23 scenarios: durable local write, offline
reload, rapid-edit coalescing, hide/pagehide flush, interrupted-write and corruption recovery,
no-upload-of-corrupt-state, quota-failure surfacing, offline startup, reconnection/tie/error
reconciliation, logout during a pending write, account isolation, stale-session rejection).

## Controlled PWA updates (P0-D)

An app update must never reload the mobile app during active or unsaved work, activate a
half-downloaded build, strand the user offline after a failed install, or lose the P0-C
offline snapshot. The service worker (`mobile/sw.js`) and a small update coordinator in
`mobile/app.js` make updates **atomic** and **user-controlled**.

**Atomic install (never a partial shell).** Each build has an explicit version constant
(`VERSION`, currently `v13`) and its own cache, `fos-<VERSION>`. On install the new worker
opens that *candidate* cache and fetches every **mandatory** same-origin shell asset
individually; a single 404/network failure aborts the whole install, deletes the partial
candidate cache, and rejects — so a partially populated cache is never promoted and never
accumulates. The **active** cache (the previous version's) is never opened or modified during
install, so a failed update leaves the last-known-good shell fully intact and offline startup
keeps working. Cross-origin brand chrome (fonts, Tabler, the Supabase CDN) is cached
best-effort and kept separate from the mandatory guarantee. *(Version bump rationale: the
candidate cache must be a distinct name from the active `fos-v12` cache for install to be
atomic — writing into `fos-v12` would modify the live cache mid-install.)*

**No forced activation.** Install does **not** call `skipWaiting()`. A new worker installs and
then **waits**. It only leaves the waiting state when the page sends a `SKIP_WAITING` message
whose `version` matches the waiting worker's own `VERSION`; malformed or wrong-version messages
are ignored. A `GET_VERSION` message lets the page identify the pending build.

**Controlled prompt + safe approval.** When a waiting worker is detected (including one already
waiting at page load), a single non-blocking bottom-bar prompt (`#swUpdate`) offers **Update
now** / **Later**. It never steals focus or interrupts an active form, POD capture, signature,
or route — the current version stays fully usable. The prompt is deduped per version, and
**Later** is session-only (it returns on the next launch). **Update now**:
1. forces a **P0-C durability flush** (`Store.flush` + `lastWriteOk` confirmation) *first*;
2. if the flush cannot be confirmed — including protective/recovery mode where in-memory state
   is a placeholder — activation is **refused**, the current version stays live, and the user is
   warned (no clobbering of good durable data);
3. only on a confirmed flush does it post the validated `SKIP_WAITING` message and reload.

**One reload, no loops.** The reload is armed only for our own approved activation, so an
unrelated `controllerchange` (a sibling tab, or the very first install) never auto-reloads —
this removes the old unconditional controller-change reload. Reload happens at most once per
page, and a `sessionStorage` marker (`fos.swActivated=<version>`) survives the reload so the
same version is never re-driven into an update loop. A bounded timeout recovers the UI if the
new worker never takes control.

**Activation preserves last-known-good.** Activation runs only after a successful atomic
install and deletes only obsolete caches this worker owns (the `fos-` prefix) — never the
current cache and never unrelated origin caches — then `clients.claim()`s. It is idempotent.

**Fetch policy is unchanged** from the approved PR #6 behavior: network-first app shell,
cache-first vendor/chrome, GET-only, and a hard bypass for live APIs (Supabase, OSRM,
Nominatim, SAM.gov) and OpenStreetMap tiles, so API/auth responses and map tiles are never
served from the app-shell cache.

Regression coverage lives outside this repo at
`../FuturoFreight_Test_Harnesses/p0d-harness.html` (40 scenarios driving the **real** `sw.js`
and the real coordinator/durability contract against mocked service-worker, cache, session, and
durability APIs — atomic install/rollback, no-forced-activation, message/version validation,
scoped cache cleanup, controlled prompt/approval, flush-before-activate, reload-once/loop-guard,
offline startup, and the preserved PR #6 fetch policy). No real service worker is registered and
no live Supabase/Netlify/production system is contacted.

**Known rollback limitation.** If activation succeeds but the one-time reload does not fire
(e.g. the browser blocks it), the bounded timeout re-enables the bar with a manual "reload to
finish" message rather than looping; the new build takes over on the next manual reload. A
sibling tab that did not itself approve the update is not force-reloaded mid-work — it adopts
the new build on its next navigation. These are the documented, safe fallbacks; they have not
been exhaustively device-tested across every browser.
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
