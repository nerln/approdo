/**
 * Mail relay of the study booking site (it sends the booking e-mails) and automatic reminders.
 *
 * Install it in the Gmail account OF THE STUDY (not a personal one): the e-mails are sent from it and the replies of the
 * participants arrive in it, unless you set REPLY_TO (see below).
 * 1. script.google.com, signed in with the study account: New project, paste this file, save.
 * 2. Project settings (gear) > Script properties:
 *    RELAY_KEY    = a random key made with the command in docs/posta.md, step 1 (required).
 *    SITE_URL     = the public address of the site, no trailing slash: the address of the site (the baseUrl of site.config.js if you set one; required for the reminders).
 *    SENDER_NAME  = the sender name recipients see, for example the brand of site.config.js (optional).
 *    TIMEZONE     = the time zone of the lab, for example Europe/Rome: the timeZone of site.config.js (optional; the project's if missing).
 *    REMINDER_HOUR = the hour (0 to 23) at which the next-day reminders go out (optional; 10 by default).
 *    REPLY_TO     = an address where replies should arrive (optional; otherwise they arrive in the study account).
 * 3. Deploy > New deployment > type Web app.
 *    Execute as: Me. Who has access: Anyone. Authorize when asked.
 * 4. Copy the URL that ends in /exec: it is MAIL_RELAY_URL (you give it to wrangler as a secret).
 * 5. Next-day reminders: pick the function installReminder in the toolbar and press Run, once.
 *    It creates a trigger that, every day at REMINDER_HOUR, calls the site, which sends tomorrow's reminders.
 *
 * The signature travels in the ?sig= parameter (Apps Script cannot read HTTP headers).
 * It is the hexadecimal HMAC-SHA256 of the raw body. The body carries "ts" (milliseconds).
 * Limit: personal Gmail accounts send at most 100 e-mails a day with MailApp.
 * When the daily quota is used up, the relay answers {ok:false, error:'quota'} and the site shows it.
 */
function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = props.getProperty('RELAY_KEY');
    if (!key) return out_({ ok: false, error: 'no key' });
    var raw = (e && e.postData && e.postData.contents) || '';
    var sig = (e && e.parameter && e.parameter.sig) || '';
    var mac = Utilities.computeHmacSha256Signature(raw, key);
    var hex = mac.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
    if (!same_(hex, String(sig).toLowerCase())) return out_({ ok: false, error: 'bad signature' });
    var m = JSON.parse(raw);
    if (!m.ts || Math.abs(Date.now() - Number(m.ts)) > 5 * 60 * 1000) return out_({ ok: false, error: 'stale' });
    if (!m.to || !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(m.to)) return out_({ ok: false, error: 'bad recipient' });
    if (MailApp.getRemainingDailyQuota() < 1) return out_({ ok: false, error: 'quota' });
    var opts = {
      to: m.to,
      subject: String(m.subject || '').slice(0, 200),
      body: String(m.text || ''),
      htmlBody: String(m.html || ''),
      name: props.getProperty('SENDER_NAME') || 'Study booking'
    };
    var replyTo = props.getProperty('REPLY_TO');
    if (replyTo) opts.replyTo = replyTo;
    MailApp.sendEmail(opts);
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

function same_(a, b) {
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Reminders: the site has no scheduler, so this script calls it once a day, signed with RELAY_KEY.
function recordatorios() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('RELAY_KEY');
  var site = String(props.getProperty('SITE_URL') || '').replace(/\/+$/, '');
  if (!site) throw new Error('Missing script property SITE_URL (the public address of the site).');
  var body = JSON.stringify({ ts: Date.now() });
  var mac = Utilities.computeHmacSha256Signature(body, key);
  var hex = mac.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  var res = UrlFetchApp.fetch(site + '/cron/remind?sig=' + hex, {
    method: 'post', contentType: 'application/json', payload: body, muteHttpExceptions: true
  });
  Logger.log(res.getResponseCode() + ' ' + res.getContentText());
}

// Run this once: it leaves a single daily trigger at REMINDER_HOUR (10 by default), in the time zone TIMEZONE.
function installReminder() {
  var props = PropertiesService.getScriptProperties();
  var hour = Number(props.getProperty('REMINDER_HOUR') || 10);
  var tz = props.getProperty('TIMEZONE') || Session.getScriptTimeZone();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'recordatorios') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('recordatorios').timeBased().everyDays(1).atHour(hour).inTimezone(tz).create();
  recordatorios();
}

// Old name, kept because the Spanish admin panel and older instructions still mention it.
function instalaRecordatorio() { installReminder(); }
