# Delivery receipts — email + text setup

When a driver completes a delivery in the mobile app, Futuro OS mints a
**confirmation number**, generates a branded **PDF receipt**, uploads it to
Supabase Storage, and calls the `send-receipt` edge function to **email**
(Resend) and **text** (Twilio) the customer a copy.

Everything works today **except the actual email/text send**, which stays
dormant until you add the provider keys below. Until then the app still creates
the confirmation number + downloadable PDF and marks the receipt "pending —
add keys to auto-send." No code changes are needed to turn it on — just secrets.

## What's already built and deployed
- Storage bucket `receipts` (public read via unguessable UUID filenames; only the owner can upload).
- Edge function `send-receipt` (JWT-protected — only your signed-in account can call it).
- Mobile app: confirmation #, PDF generation, upload, send, plus **Download PDF** / **Resend** on every completed job.

## 1. Resend (email) — ~10 min
1. Create a free account at https://resend.com.
2. Add & verify a sending domain (e.g. `futurotransport.com`) — Resend shows the DNS records (SPF/DKIM) to add at your registrar. Verification is what lets email send **from your domain** instead of a test address.
3. Create an API key (Resend → API Keys).

## 2. Twilio (text) — ~10 min
1. Create an account at https://twilio.com and buy/verify a phone number with SMS.
2. From the Twilio console copy: **Account SID**, **Auth Token**, and your **From** number (E.164, e.g. `+15551234567`).

## 3. Add the secrets to Supabase
Supabase Dashboard → **Edge Functions → send-receipt → Secrets** (or Project Settings → Edge Functions → Secrets). Add:

| Secret | Value |
|---|---|
| `RESEND_API_KEY` | your Resend API key |
| `RESEND_FROM` | `Futuro Transport <delivery@futurotransport.com>` (must be on the verified domain) |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token |
| `TWILIO_FROM_NUMBER` | `+15551234567` |

Each channel is independent: set only Resend and you get email-only; set only
Twilio and you get text-only. No redeploy needed — the function reads the
secrets on the next call.

## 4. Test
On a phone (signed in to Futuro OS), complete a delivery on a job that has a
customer email and/or phone. You should get the email + text within a few
seconds; the job detail's **Customer receipt** section shows `Email: ✓ sent` /
`Text: ✓ sent`. Use **Resend** there to retry.

## Notes
- Customer **email** is captured on the job (Jobs → customer email); **phone** drives the text.
- **Secured deliveries**: the driver verifies recipient ID first (barcode scan on Android; photo + manual confirm on iOS). Only the *result* (name match / age / not-expired) is stored — never the ID number or image. The receipt notes "Identity verified."
- PDF receipts live in the `receipts` bucket. Links are unguessable but public — anyone with the exact link can open that one receipt (standard for receipt links). Switch to signed URLs if you want time-limited links.
