# Connecting your websites to Futuro OS

Everything flows through one Supabase project. Website inquiry forms post into the
`inbound_leads` / `inbound_carriers` tables; Futuro OS reads them:

```
futurosolutions.net  ──┐
                       ├──►  Supabase (inbound_leads / inbound_carriers)
futurotransport.com ───┘              │
                                      ├──►  Desktop app → Intake → Portal Inbox
                                      └──►  Mobile app  → Biz → Website inbox
```

Accepting an inquiry in either app turns it into a pipeline lead (and can become an
order/job from there). Dismissing marks it handled. Rows are owner-scoped to your
account; anonymous visitors can only *insert*, never read.

## Two ready-made forms

| File | Posts to | Use on |
|---|---|---|
| `shipper-inquiry-form.html` | `inbound_leads` | futurosolutions.net ("Request a quote") |
| `carrier-signup-form.html` | `inbound_carriers` | futurotransport.com ("Haul with us") |

Both are self-contained single files (brand-styled, honeypot spam trap, success/error
states, no dependencies beyond the Syne font). The `source` column is stamped
automatically with the site's hostname, so you can tell which website each inquiry
came from; override with `?source=whatever` in the URL if embedding via iframe.

## Three ways to put them on a site

1. **Link to them** — they deploy with this repo, so once Netlify publishes:
   `https://<your-app-site>/integrations/shipper-inquiry-form.html`.
   Point any "Get a quote" button at that URL.
2. **Iframe embed** — paste into any page/site-builder block:
   ```html
   <iframe src="https://<your-app-site>/integrations/shipper-inquiry-form.html?source=futurosolutions.net"
           style="width:100%;max-width:560px;height:760px;border:0" title="Request a quote"></iframe>
   ```
3. **Native embed** — if you control the site's HTML, copy the `<form>` block and the
   `<script>` block from the file into your page and restyle the form freely. Only the
   script (the fetch POST) and the input `name=` attributes matter.

## Posting from any existing form you already have

If a site already has its own form, keep it — just send the values to Futuro OS from
its submit handler:

```js
await fetch('https://plsimvwufpqquuipkysi.supabase.co/rest/v1/inbound_leads', {
  method: 'POST',
  headers: {
    'apikey': '<publishable key>',            // same key the apps use — safe to expose
    'Authorization': 'Bearer <publishable key>',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  },
  body: JSON.stringify({
    name, company, email, phone,
    equipment,            // 'Dry Van' | 'Reefer' | 'Flatbed' | 'Other / Multiple'
    lane,                 // free text, e.g. 'Richmond, VA → Atlanta, GA'
    message,              // free text
    source: location.hostname,
    status: 'new'
  })
});
```

Carrier signups are identical against `/rest/v1/inbound_carriers` with fields
`name, company, email, phone, mc, dot, equipment, lanes, message, source`.

## Database side (already applied)

- Anonymous (`anon`) INSERT policies exist on both inbound tables, locked to your
  owner id — visitors can submit but never read, update, or delete.
- The `owner` column default was repaired to your real auth user
  (it previously pointed at a non-existent user, which silently blocked every
  insert via a foreign-key violation — the funnel could never have delivered).
