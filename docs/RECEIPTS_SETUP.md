# Delivery receipts + Google Workspace setup

When a driver completes a delivery, Futuro OS mints a **confirmation number**,
generates a branded **PDF receipt**, and (once configured) **emails + texts** it
to the customer. Delivery windows can also mirror to your **Google Calendar**,
and receipt PDFs can be saved to **Google Drive**.

Everything works today **except the actual sends**, which stay dormant until you
add the keys below. Until then the app still creates the confirmation number +
downloadable PDF. No code changes are needed to turn things on — just secrets.

## What's already built and deployed
- Storage bucket `receipts` (public read via unguessable UUIDs; owner-only upload).
- Edge functions `send-receipt` (email + SMS) and `sync-calendar` (both JWT-protected).
- Mobile: confirmation #, PDF, upload, send, Download/Resend; POD photos offloaded to Storage.
- Desktop **Deliveries** page + both apps call calendar sync when a delivery with a date is saved/deleted.

## Email + Drive via your Google Workspace (recommended)
This sends receipts from **your own Gmail** and saves PDFs to **your Drive** — no
third-party email service, no domain DNS.

1. Open https://script.google.com → **New project**. Delete the sample and paste the
   contents of [`integrations/google-apps-script/Code.gs`](../integrations/google-apps-script/Code.gs).
2. Set `TOKEN` (top of the file) to a long random string. Keep it secret.
3. **Deploy → New deployment → Web app**: *Execute as* **Me**, *Who has access* **Anyone**. Copy the **Web app URL**.
4. Approve the Gmail / Drive / Calendar permission prompt on first deploy.
5. In Supabase → **Edge Functions → Secrets**, add:
   | Secret | Value |
   |---|---|
   | `GAS_URL` | the Web app URL from step 3 |
   | `GAS_TOKEN` | the same `TOKEN` string from step 2 |

That's it — email now sends from Gmail, PDFs save to a **"Futuro OS Receipts"**
Drive folder, and calendar sync is live. (When you edit the script later, redeploy
a **new version** or the URL keeps serving the old code.)

> Gmail sending limits: ~100 emails/day on a consumer `@gmail.com`, ~1,500/day on a
> Workspace domain — plenty for a solo operation. Emails come from your Gmail address.

### Email alternative — Resend (only if you'd rather not use Gmail)
If `GAS_URL` is **not** set, the function falls back to Resend. Set
`RESEND_API_KEY` and `RESEND_FROM` (a verified-domain address) instead.

## Text messages via Twilio
Google Workspace can't send SMS, so texts use Twilio (skip this for email-only).
1. Create a Twilio account, get an SMS-capable number.
2. Add secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (E.164, e.g. `+15551234567`).

## Test
On a phone signed in to Futuro OS, complete a delivery on a job that has a customer
email and/or phone. Within a few seconds you should get the email (from your Gmail) +
text; the PDF appears in the Drive folder; the job detail's **Customer receipt**
section shows `Email: ✓ sent`. Create a dated delivery and check it lands on your
Google Calendar.

## Notes
- Each channel is independent: set only Gmail (GAS) for email-only; add Twilio for texts; both are optional.
- **Secured deliveries** verify recipient ID (barcode scan on Android, photo+confirm on iOS) before completion; only the *result* is stored, never the ID number or image.
- Calendar events are tagged by job id and de-duplicated, so editing a delivery updates its event and deleting removes it.
