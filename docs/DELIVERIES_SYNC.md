# Shared delivery job list (desktop ↔ mobile)

The desktop app and the mobile driver app now share **one** delivery job list,
so a job created or edited in either place appears in the other — live.

## How it works
- A Supabase table `public.jobs` holds the shared delivery jobs, owner-scoped by
  RLS (`owner = auth.uid()`) exactly like every other table — only your account
  can see or change them.
- **Desktop**: a new **Deliveries** page (Dispatch → Deliveries) lists, creates,
  and edits these jobs. The sidebar shows an open-count badge.
- **Mobile**: the driver app uses `public.jobs` as its job store (it no longer
  keeps jobs inside the `mobile_snapshot` blob — deals and settings still live
  there). Existing jobs are migrated up automatically the first time the updated
  app runs while signed in.
- **Realtime**: both apps subscribe to changes, so an edit on one device shows on
  the other within a second (and there's a manual Refresh too).

## Sync semantics (important)
- Both apps keep a local copy so they work **offline**; changes sync when back online.
- On load, **server rows win** for jobs that exist in both places; jobs created
  offline on a device are preserved and pushed up. In the rare case you edit the
  *same* job offline on two devices before either syncs, the last one to reach the
  server wins. For a solo operator using one device at a time this is a non-issue.

## Please do a quick two-device check
The cross-device sync only runs while **signed in**, so it needs your account to
verify end to end (it couldn't be tested without your login). Once deployed:

1. On the **desktop** app (signed in), go to **Dispatch → Deliveries** and create a delivery.
2. On your **phone** (signed in to the same account, updated app), open the app — the job should appear on the Today/Jobs list within a second or two.
3. On the phone, start and complete that delivery (POD). Back on the desktop Deliveries page, the status should flip to **Delivered** and show the receipt confirmation number.
4. Create a job on the **phone** and confirm it appears on the **desktop** Deliveries page.

If anything doesn't line up, tell me — this change is isolated to the Deliveries
surface + the mobile job-sync, so it's easy to adjust or roll back without
touching the rest of either app.

## Notes
- Desktop's existing **Control Tower** jobs (Live Jobs, Dispatch Board, GovCon shipments) are a separate, richer logistics system and are unchanged. "Deliveries" is specifically the shared driver list.
- Secured deliveries, ID verification, and PDF receipts all travel with the job, so a delivery dispatched from the desktop carries its secured flag + min-age to the driver, and the receipt/ID result flows back.
