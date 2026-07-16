/**
 * Futuro OS — Google Workspace bridge
 * ------------------------------------
 * Runs inside YOUR Google account so it can send Gmail, save PDFs to Drive,
 * and put delivery windows on your Calendar — no third-party email service and
 * no domain DNS needed. The Supabase `send-receipt` and `sync-calendar` edge
 * functions call this web app; a shared token is the only credential.
 *
 * DEPLOY (one time):
 *  1. Go to https://script.google.com → New project. Paste this file in.
 *  2. Set TOKEN below to a long random string (keep it secret).
 *  3. Deploy → New deployment → type "Web app".
 *       - Execute as: Me
 *       - Who has access: Anyone
 *     Copy the Web app URL.
 *  4. First deploy will ask you to authorize Gmail/Drive/Calendar — approve.
 *  5. In Supabase → Edge Functions → Secrets, set:
 *       GAS_URL   = the Web app URL
 *       GAS_TOKEN = the same TOKEN string
 *  6. To change this script later, re-Deploy (Manage deployments → edit → new version).
 */

const TOKEN = 'CHANGE_ME_to_a_long_random_string';
const DRIVE_FOLDER = 'Futuro OS Receipts';   // created automatically if missing
const CALENDAR_ID = 'primary';               // 'primary' = your main calendar

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.token !== TOKEN) return json({ error: 'unauthorized' });
    if (body.action === 'receipt')  return json(handleReceipt(body));
    if (body.action === 'calendar') return json(handleCalendar(body));
    return json({ error: 'unknown action' });
  } catch (err) {
    return json({ error: String(err) });
  }
}

function doGet() { return json({ ok: true, service: 'futuro-os-bridge' }); }

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- receipt: Gmail email (+ PDF attachment) + save PDF to Drive ----
function handleReceipt(b) {
  const out = { email: 'skipped', drive: 'skipped' };
  let pdfBlob = null;
  if (b.pdfUrl) {
    try {
      pdfBlob = UrlFetchApp.fetch(b.pdfUrl).getBlob()
        .setName('receipt-' + (b.confirmation || 'delivery') + '.pdf');
    } catch (err) { /* attachment optional */ }
  }
  if (pdfBlob) {
    try {
      const file = getFolder_(DRIVE_FOLDER).createFile(pdfBlob);
      out.drive = 'saved'; out.driveUrl = file.getUrl();
    } catch (err) { out.drive = 'error'; }
  }
  if (b.customerEmail) {
    try {
      const opts = { htmlBody: receiptHtml_(b), name: b.company || 'Futuro OS' };
      if (pdfBlob) opts.attachments = [pdfBlob];
      GmailApp.sendEmail(
        b.customerEmail,
        'Delivery confirmed — ' + (b.confirmation || b.company || ''),
        'Your delivery is complete. Confirmation ' + (b.confirmation || '') + (b.pdfUrl ? ('\nReceipt: ' + b.pdfUrl) : ''),
        opts
      );
      out.email = 'sent';
    } catch (err) { out.email = 'error'; out.emailDetail = String(err); }
  }
  return out;
}

// ---- calendar: create / update / remove a delivery-window event ----
function handleCalendar(b) {
  if (!b.job_date) return { calendar: 'no_date' };
  const cal = CALENDAR_ID === 'primary'
    ? CalendarApp.getDefaultCalendar()
    : CalendarApp.getCalendarById(CALENDAR_ID);
  const start = parseWhen_(b.job_date, b.win_s || '09:00');
  const end   = parseWhen_(b.job_date, b.win_e || b.win_s || '10:00');
  // remove any existing event we previously created for this job that day
  const dayStart = new Date(start); dayStart.setHours(0, 0, 0, 0);
  const dayEnd   = new Date(start); dayEnd.setHours(23, 59, 59, 0);
  cal.getEvents(dayStart, dayEnd)
    .filter(ev => ev.getTag('fosJob') === String(b.id))
    .forEach(ev => ev.deleteEvent());
  if (b.remove) return { calendar: 'removed' };
  const title = (b.type === 'pickup' ? 'Pickup' : 'Delivery') + ' — ' + (b.customer || '');
  const ev = cal.createEvent(title, start, end, {
    location: b.address || '',
    description: 'Futuro OS ' + (b.type || 'delivery') + ' · job ' + b.id
  });
  ev.setTag('fosJob', String(b.id));
  return { calendar: 'synced', eventId: ev.getId() };
}

function parseWhen_(dateStr, hhmm) {
  const parts = String(hhmm || '09:00').split(':');
  const d = new Date(dateStr + 'T00:00:00');
  d.setHours(Number(parts[0]) || 9, Number(parts[1]) || 0, 0, 0);
  return d;
}
function getFolder_(name) {
  const it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}
function receiptHtml_(b) {
  return '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#0f172a">'
    + '<h2 style="margin:0 0 4px">Delivery confirmed</h2>'
    + '<p style="color:#475569;margin:0 0 16px">Hi ' + esc_(b.customerName || 'there') + ', your delivery from '
    + esc_(b.company || 'us') + ' is complete.</p>'
    + '<p style="margin:6px 0"><b>Confirmation:</b> ' + esc_(b.confirmation || '') + '</p>'
    + (b.address ? '<p style="margin:6px 0"><b>Address:</b> ' + esc_(b.address) + '</p>' : '')
    + (b.when ? '<p style="margin:6px 0"><b>Completed:</b> ' + esc_(b.when) + '</p>' : '')
    + (b.pdfUrl ? '<p style="margin:18px 0"><a href="' + b.pdfUrl
        + '" style="background:#136131;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px">Download PDF receipt</a></p>' : '')
    + '<p style="color:#94a3b8;font-size:12px;margin-top:16px">Thank you for choosing ' + esc_(b.company || 'us') + '.</p></div>';
}
function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
