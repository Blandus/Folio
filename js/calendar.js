// Calendar ("Kalender" in the library sidebar): week view and month view (settings.calView).
//
// Sources, each shown with its colour and named in the event details:
// - Folio: own events, stored as records { kind: 'event' } and synced with Google Drive like
//   documents. Times are wall-clock times in the zone of the device that created them (tz).
//   { date, start, endDate?, end, allDay? }: endDate (ab v80) makes an event span several days;
//   without it the event ends on its start day (or the next one when end ≤ start, as before).
//   All-day events have no times; they last from date to endDate inclusive.
//   Weekly repetition (optionally until a date); single occurrences can be changed or cancelled
//   (exceptions, keyed by the original date).
// - ICS: subscriptions (URL, refreshed by hand) and imported .ics files, stored as records
//   { kind: 'calfeed' } with their parsed events (ics.js); re-importing replaces the events of
//   the same import, so changes and cancellations arrive without duplicates. Many calendar
//   servers don't allow reading from a web page (no CORS) — then the feed can be added to Google
//   Calendar ("Per URL") and shown here through the Google connection.
// - Google Calendar (optional, separate consent from Drive): calendars to show, events of the
//   visible week; create/edit/delete on calendars the user may write to. The token and events
//   live only in memory (nothing cached, nothing stored).
import { $, h, uid, pickFile } from './util.js';
import { icon } from './icons.js';
import { store, settings, saveSettings, bus } from './store.js';
import { sheet, toast, segmented, confirmBox, toggle } from './ui.js';
import { parseICS, expandEvents, wallToMs, validTz } from './ics.js';
import { CLIENT_ID } from './sync.js';

export const CAL_KINDS = new Set(['event', 'calfeed']);
const HOUR = 44; // px per hour
const FOLIO_COLOR = '#3E6E9F';
const FEED_COLORS = ['#6B8F7E', '#C9A35B', '#7D6B91', '#4F7A66', '#B8A68A', '#8EB8E6'];
const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || null;

// ---------- Dates ----------
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
const parseHm = s => { const [hh, mi] = s.split(':').map(Number); return { h: hh, mi }; };
const dayAt = (ws, i) => { const d = new Date(ws); d.setDate(d.getDate() + i); return d; };
function weekStartOf(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }
function isoWeek(t) {
  const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}
const fmtDay = d => d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
const fmtTime = t => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const addDays = (s, n) => { const d = new Date(s + 'T00:00'); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00') - Date.parse(a + 'T00:00')) / 86400000);
const monthStartOf = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(1); return d.getTime(); };
// "Mo., 3. Nov. · 10:00–11:00", "3. – 7. Nov. · ganztägig", "Fr., 3. Nov. 18:00 – So., 5. Nov. 12:00"
function fmtWhen(o) {
  const long = t => new Date(t).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
  if (o.allDay) {
    const last = o.end - o.start > 86400000 ? o.end - 1 : o.start;
    return ymd(new Date(last)) === ymd(new Date(o.start)) ? `${long(o.start)} · ganztägig` : `${long(o.start)} – ${long(last)} · ganztägig`;
  }
  if (ymd(new Date(o.start)) === ymd(new Date(o.end - 1))) return `${long(o.start)} · ${fmtTime(o.start)}–${fmtTime(o.end)}`;
  return `${long(o.start)} ${fmtTime(o.start)} – ${long(o.end)} ${fmtTime(o.end)}`;
}

const cal = {
  ws: weekStartOf(Date.now()), month: monthStartOf(Date.now()), view: settings.calView === 'month' ? 'month' : 'week',
  scroll: null, records: [], gcache: new Map(), gerr: '', loadingG: false, mLines: 3,
};
// the visible range [from, to) of the current view (the month view shows 6 whole weeks)
const range = () => (cal.view === 'month' ? [weekStartOf(cal.month), dayAt(weekStartOf(cal.month), 42).getTime()] : [cal.ws, dayAt(cal.ws, 7).getTime()]);

// ---------- Own events ----------
// x: { date, endDate?, start, end, allDay? } (the event, or one changed occurrence)
function ownTimes(r, x) {
  const endDate = x.endDate && x.endDate > x.date ? x.endDate : x.date;
  if (x.allDay) return [wallToMs(parseYmd(x.date), null), wallToMs(parseYmd(addDays(endDate, 1)), null)];
  const tz = validTz(r.tz || '') ? r.tz : null;
  const s = wallToMs({ ...parseYmd(x.date), ...parseHm(x.start) }, tz);
  let e = wallToMs({ ...parseYmd(endDate), ...parseHm(x.end) }, tz);
  if (e <= s) e = endDate === x.date ? e + 86400000 : s + 15 * 60000; // same day: ends after midnight
  return [s, e];
}
const spanOf = r => (r.endDate && r.endDate > r.date ? daysBetween(r.date, r.endDate) : 0);
function expandOwn(r, from, to) {
  const out = [];
  const span = spanOf(r);
  const add = (dateStr, x, occDate) => {
    const v = x.date ? { allDay: !!x.allDay, ...x } : { date: dateStr, endDate: addDays(dateStr, span), start: r.start, end: r.end, allDay: !!r.allDay };
    const [s, e] = ownTimes(r, v);
    if (e > from && s < to) out.push({ key: `f|${r.id}|${occDate}`, source: 'folio', rec: r, occDate, title: x.title || r.title || '(ohne Titel)', start: s, end: e, allDay: !!v.allDay, color: FOLIO_COLOR, srcName: 'Folio', editable: true, recurring: !!r.weekly });
  };
  if (!r.weekly) { add(r.date, {}, r.date); return out; }
  const first = parseYmd(r.date);
  const until = r.until ? wallToMs({ ...parseYmd(r.until), h: 23, mi: 59 }, null) : Infinity;
  const base = Date.UTC(first.y, first.m - 1, first.d);
  // start a little before the window instead of at the first occurrence
  const k0 = Math.max(0, Math.floor((from - wallToMs(first, null)) / (7 * 86400000)) - 1 - Math.ceil(span / 7));
  for (let k = k0; k < k0 + 60; k++) {
    const d = new Date(base + k * 7 * 86400000);
    const ds = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const [s] = ownTimes(r, { date: ds, start: r.start, end: r.end, allDay: r.allDay });
    if (s > until || s >= to + 86400000) break;
    const x = r.exceptions?.[ds];
    if (x?.cancelled) continue;
    add(ds, x || {}, ds);
  }
  return out;
}

// ---------- Google Calendar ----------
// Separate token with only the calendar scopes; Drive sign-in is not affected (and works without it).
const G_SCOPES = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events';
const g = { token: null, exp: 0 };
const gValid = () => g.token && Date.now() < g.exp - 60000;
function gToken() { // must run in a user gesture (tap)
  return new Promise((res, rej) => {
    if (gValid()) return res(g.token);
    if (!window.google?.accounts?.oauth2) return rej(new Error('Google-Login nicht geladen (offline?)'));
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: G_SCOPES, include_granted_scopes: false,
      ...(settings.account?.email ? { login_hint: settings.account.email } : {}),
      callback: r => {
        if (r.error) return rej(new Error(r.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, ...G_SCOPES.split(' '))) return rej(new Error('Kalender-Zugriff nicht vollständig erlaubt'));
        g.token = r.access_token; g.exp = Date.now() + r.expires_in * 1000; res(g.token);
      },
      error_callback: err => rej(new Error(err.message || err.type)),
    });
    tc.requestAccessToken({ prompt: settings.gcal?.on ? '' : 'consent' });
  });
}
async function gapi(path, opts = {}) {
  const r = await fetch('https://www.googleapis.com/calendar/v3/' + path, {
    ...opts, cache: 'no-store', headers: { Authorization: 'Bearer ' + g.token, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (r.status === 401) { g.token = null; throw new Error('Google-Sitzung abgelaufen'); }
  if (!r.ok) throw new Error(`Google Kalender ${r.status}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}
const gcfg = () => (settings.gcal ||= { on: false, cals: {}, target: 'folio' });
// Calendars added in Google "per URL" are often named after their address (with secret tokens): show only the server
const calName = c => { if (!/^(https?|webcal):\/\//i.test(c.name)) return c.name; try { return 'Abo von ' + new URL(c.name.replace(/^webcal:/i, 'https:')).hostname; } catch { return 'Abo per URL'; } };
const writable = c => c && (c.role === 'writer' || c.role === 'owner');

async function gListCalendars() {
  const items = [];
  let tok = '';
  do {
    const r = await gapi(`users/me/calendarList?maxResults=250${tok ? '&pageToken=' + encodeURIComponent(tok) : ''}`);
    items.push(...(r.items || [])); tok = r.nextPageToken;
  } while (tok);
  const cfg = gcfg(), cals = {};
  for (const c of items) {
    if (c.accessRole === 'freeBusyReader') continue;
    cals[c.id] = { name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || '#8EB8E6', role: c.accessRole, primary: !!c.primary, on: cfg.cals[c.id] ? cfg.cals[c.id].on : !!(c.primary || c.selected) };
  }
  cfg.cals = cals;
  if (cfg.target !== 'folio' && !writable(cals[cfg.target])) cfg.target = 'folio';
  saveSettings();
}

// events of the visible range (a week, or the six weeks of the month view)
const rangeKey = () => range().join('|');
async function gLoadRange(force) {
  const cfg = gcfg();
  if (!cfg.on || !gValid()) return;
  const key = rangeKey();
  if (!force && cal.gcache.has(key)) return;
  const [from, to] = range().map(t => new Date(t));
  const out = [];
  cal.loadingG = true;
  try {
    for (const [id, c] of Object.entries(cfg.cals)) {
      if (!c.on) continue;
      let tok = '';
      do {
        const q = `timeMin=${encodeURIComponent(from.toISOString())}&timeMax=${encodeURIComponent(to.toISOString())}&singleEvents=true&orderBy=startTime&maxResults=2500${tok ? '&pageToken=' + encodeURIComponent(tok) : ''}`;
        const r = await gapi(`calendars/${encodeURIComponent(id)}/events?${q}`);
        for (const e of r.items || []) {
          if (e.status === 'cancelled' || !e.start) continue;
          const allDay = !!e.start.date;
          const s = allDay ? wallToMs(parseYmd(e.start.date), null) : Date.parse(e.start.dateTime);
          const en = allDay ? wallToMs(parseYmd(e.end?.date || e.start.date), null) : Date.parse(e.end?.dateTime || e.start.dateTime);
          out.push({
            key: `g|${id}|${e.id}`, source: 'google', calId: id, id: e.id, recurringEventId: e.recurringEventId || null,
            title: e.summary || '(ohne Titel)', location: e.location || '', description: e.description || '', start: s, end: Math.max(en, s), allDay,
            color: c.color, srcName: 'Google: ' + calName(c), editable: writable(c) && (!e.eventType || e.eventType === 'default'), recurring: !!e.recurringEventId,
          });
        }
        tok = r.nextPageToken;
      } while (tok);
    }
    cal.gcache.set(key, out); cal.gerr = '';
  } catch (err) { cal.gerr = err.message; }
  cal.loadingG = false;
}

async function gConnect() {
  try {
    await gToken();
    gcfg().on = true; saveSettings();
    await gListCalendars();
    cal.gcache.clear(); await gLoadRange(true);
    toast('Google Kalender verbunden');
  } catch (err) { toast('⚠ ' + err.message, 4000); }
  render();
}
function gDisconnect() {
  if (g.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(g.token, () => {});
  g.token = null; g.exp = 0;
  settings.gcal = { on: false, cals: {}, target: 'folio' }; saveSettings();
  cal.gcache.clear(); render();
}
// After the ~1 h token runs out, a tap renews it (Google needs a user gesture).
async function gReload() {
  try { await gToken(); cal.gcache.clear(); await gLoadRange(true); } catch (err) { cal.gerr = err.message; }
  render();
}

// v: { date, endDate, start, end, allDay } from the event sheet. All-day: Google's end date is exclusive.
const gTimes = v => {
  if (v.allDay) return { start: { date: v.date }, end: { date: addDays(v.endDate || v.date, 1) } };
  const tz = localTz();
  return { start: { dateTime: `${v.date}T${v.start}:00`, timeZone: tz }, end: { dateTime: `${v.endDate}T${v.end}:00`, timeZone: tz } };
};

// ---------- ICS feeds ----------
const httpsUrl = u => u.trim().replace(/^webcal:\/\//i, 'https://');
async function fetchFeed(url) {
  let r;
  try { r = await fetch(httpsUrl(url), { cache: 'no-store', credentials: 'omit', redirect: 'follow' }); }
  catch { throw new Error('Der Kalender-Server erlaubt den Abruf aus dem Browser nicht (CORS) oder ist nicht erreichbar.'); }
  if (!r.ok) throw new Error(`Abruf fehlgeschlagen (${r.status}).`);
  const text = await r.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Keine iCalendar-Daten.');
  return parseICS(text);
}
async function refreshFeeds() {
  for (const f of cal.records.filter(r => r.kind === 'calfeed' && r.url && !r.deleted)) {
    try { const p = await fetchFeed(f.url); Object.assign(f, { events: p.events, fetched: Date.now(), error: '', updated: Date.now() }); }
    catch (err) { Object.assign(f, { error: err.message, updated: Date.now() }); }
    await store.put(f);
  }
}
async function subscribe(url) {
  url = httpsUrl(url);
  if (!/^https:\/\//i.test(url)) { toast('Bitte eine https:// oder webcal:// Adresse eingeben'); return false; }
  try {
    const p = await fetchFeed(url);
    const now = Date.now();
    await store.put({ kind: 'calfeed', id: uid(), name: p.name || new URL(url).hostname, url, color: nextColor(), events: p.events, fetched: now, created: now, updated: now });
    toast(`Abonniert: ${p.events.length} Termine`);
    return true;
  } catch (err) {
    await sheet({
      title: 'Abo nicht möglich', done: 'OK', cancel: false,
      body: h('div', { class: 'cal-help' },
        h('p', {}, err.message),
        h('p', {}, 'So geht es trotzdem: Füge den Kalender in Google Kalender über „Weitere Kalender → + → Per URL“ hinzu und verbinde hier Google Kalender. Er erscheint dann (nur lesbar) in Folio.'),
        h('p', {}, h('a', { href: 'https://support.google.com/calendar/answer/37100?hl=de', target: '_blank', rel: 'noopener' }, 'Google-Hilfe: Kalender per URL hinzufügen'))),
    });
    return false;
  }
}
async function importFile() {
  const f = await pickFile('.ics,text/calendar');
  if (!f) return;
  let p;
  try { p = parseICS(await f.text()); } catch { return toast('Datei konnte nicht gelesen werden'); }
  if (!p.events.length) return toast('Keine Termine in der Datei');
  const name = p.name || f.name.replace(/\.ics$/i, '');
  const now = Date.now();
  const same = cal.records.find(r => r.kind === 'calfeed' && !r.deleted && !r.url && r.name === name);
  if (same && await confirmBox('Schon importiert', `„${name}“ wurde schon importiert. Mit dieser Datei aktualisieren (Änderungen und Absagen werden übernommen)?`, 'Aktualisieren')) {
    Object.assign(same, { events: p.events, fetched: now, updated: now });
    await store.put(same);
  } else if (!same) {
    await store.put({ kind: 'calfeed', id: uid(), name, url: null, color: nextColor(), events: p.events, fetched: now, created: now, updated: now });
  } else return;
  const unsupported = p.events.filter(e => e.unsupported).length;
  toast(`${p.events.length} Termine importiert${unsupported ? ` · ${unsupported} mit nicht unterstützter Wiederholung (nur erster Termin)` : ''}`, 4000);
}
const nextColor = () => FEED_COLORS[cal.records.filter(r => r.kind === 'calfeed' && !r.deleted).length % FEED_COLORS.length];
const tombstone = r => ({ kind: r.kind, id: r.id, name: r.name, deleted: true, updated: Date.now(), pages: [] });

// ---------- Occurrences of the visible range ----------
function rangeItems() {
  const [from, to] = range();
  const items = [];
  for (const r of cal.records) {
    if (r.deleted) continue;
    if (r.kind === 'event') items.push(...expandOwn(r, from, to));
    if (r.kind === 'calfeed') for (const o of expandEvents(r.events || [], from, to)) {
      items.push({ ...o, key: `i|${r.id}|${o.key}`, source: 'ics', feed: r, color: r.color || FEED_COLORS[0], srcName: (r.url ? 'Abo: ' : 'Import: ') + r.name, editable: false });
    }
  }
  if (gcfg().on) items.push(...(cal.gcache.get(rangeKey()) || []));
  // the same appointment from two sources (e.g. a feed imported and also shown via Google): once
  const seen = new Set();
  return items.filter(o => { const k = `${o.title.trim().toLowerCase()}|${o.start}|${o.end}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// Columns for overlapping events within one day
function layout(list) {
  list.sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s));
  let cluster = [], cols = [], clusterEnd = -Infinity;
  const close = () => { for (const x of cluster) x.n = cols.length; cluster = []; cols = []; };
  for (const x of list) {
    if (x.s >= clusterEnd) { close(); clusterEnd = -Infinity; }
    let c = cols.findIndex(end => end <= x.s);
    if (c < 0) { c = cols.length; cols.push(0); }
    cols[c] = x.e; x.col = c; cluster.push(x); clusterEnd = Math.max(clusterEnd, x.e);
  }
  close();
  return list;
}

// ---------- Bars (all-day and multi-day events across the days of a week) ----------
const overlaps = (o, s, e) => (o.end > s && o.start < e) || (o.end === o.start && o.start >= s && o.start < e);
// More than one calendar day (an event ending at midnight ends the day before)
const multiDay = o => ymd(new Date(o.start)) !== ymd(new Date(Math.max(o.start, o.end - 1)));
// Pieces of consecutive days (0–6) on which inBar(o, i) holds; open ends where the event goes on
function barSegs(items, ds, de, inBar) {
  const segs = [];
  for (const o of items) {
    let a = -1;
    for (let i = 0; i <= 7; i++) {
      const on = i < 7 && overlaps(o, ds[i], de[i]) && inBar(o, i);
      if (on && a < 0) a = i;
      if (!on && a >= 0) { segs.push({ o, a, b: i - 1, openL: o.start < ds[a], openR: o.end > de[i - 1] }); a = -1; }
    }
  }
  return segs;
}
// Rows ("lanes") for the bars: longer and earlier ones first, each in the first free lane
function lanes(segs) {
  segs.sort((x, y) => x.a - y.a || (y.b - y.a) - (x.b - x.a) || x.o.start - y.o.start);
  const ends = [];
  for (const s of segs) {
    let l = ends.findIndex(e => e < s.a);
    if (l < 0) { l = ends.length; ends.push(0); }
    ends[l] = s.b; s.lane = l;
  }
  return ends.length;
}
const barBtn = (s, col, row, from = s.a, to = s.b) => h('button', {
  class: 'cal-bar' + (s.openL && from === s.a ? ' open-l' : '') + (s.openR && to === s.b ? ' open-r' : ''),
  style: { '--ec': s.o.color, gridColumn: `${col + from} / span ${to - from + 1}`, gridRow: String(row) },
  title: `${s.o.title} · ${fmtWhen(s.o)} · ${s.o.srcName}`,
  onclick: e => { e.stopPropagation(); openItem(s.o); },
}, h('span', {}, s.o.title));

// ---------- View ----------
let headEl, bodyEl;
export async function renderCalendar(head, content) {
  if (!content.querySelector('.cal')) cal.scroll = null; // coming from another view: start at the current time again
  headEl = head; bodyEl = content;
  cal.records = (await store.list()).filter(r => CAL_KINDS.has(r.kind));
  if (gcfg().on && gValid() && !cal.gcache.has(rangeKey()) && !cal.loadingG) gLoadRange().then(render);
  draw();
}
const render = () => { if (headEl?.isConnected) renderCalendar(headEl, bodyEl); };

function go(ws) { cal.ws = ws; render(); }
function goMonth(t) { cal.month = monthStartOf(t); render(); }
function setView(v, week = null) { // week: show this week (a day tapped in the month)
  cal.view = v; settings.calView = v; saveSettings();
  // keep the place: the week of the shown month's first day (or today), the month of the shown week
  if (v === 'month') cal.month = monthStartOf(Date.now() >= cal.ws && Date.now() < dayAt(cal.ws, 7).getTime() ? Date.now() : cal.ws);
  else { const now = Date.now(); cal.ws = week ?? weekStartOf(monthStartOf(now) === cal.month ? now : cal.month); cal.scroll = null; }
  render();
}

function draw() {
  const month = cal.view === 'month';
  const nav = month
    ? h('div', { class: 'cal-nav' },
      h('button', { class: 'iconbtn plain', title: 'Voriger Monat', 'aria-label': 'Voriger Monat', onclick: () => goMonth(new Date(cal.month).setMonth(new Date(cal.month).getMonth() - 1)) }, icon('chevronLeft', 20)),
      h('button', { class: 'pill-btn', onclick: () => goMonth(Date.now()) }, 'Heute'),
      h('button', { class: 'iconbtn plain', title: 'Nächster Monat', 'aria-label': 'Nächster Monat', onclick: () => goMonth(new Date(cal.month).setMonth(new Date(cal.month).getMonth() + 1)) }, icon('chevronRight', 20)),
      h('span', { class: 'cal-range' }, new Date(cal.month).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })))
    : h('div', { class: 'cal-nav' },
      h('button', { class: 'iconbtn plain', title: 'Vorige Woche', 'aria-label': 'Vorige Woche', onclick: () => go(dayAt(cal.ws, -7).getTime()) }, icon('chevronLeft', 20)),
      h('button', { class: 'pill-btn', onclick: () => go(weekStartOf(Date.now())) }, 'Heute'),
      h('button', { class: 'iconbtn plain', title: 'Nächste Woche', 'aria-label': 'Nächste Woche', onclick: () => go(dayAt(cal.ws, 7).getTime()) }, icon('chevronRight', 20)),
      h('span', { class: 'cal-range' }, `KW ${isoWeek(cal.ws)} · ${fmtDay(new Date(cal.ws))} – ${fmtDay(dayAt(cal.ws, 6))} ${dayAt(cal.ws, 6).getFullYear()}`));
  const cfg = gcfg();
  const actions = h('div', { class: 'lib-actions' },
    segmented([['week', 'Woche'], ['month', 'Monat']], cal.view, setView),
    cfg.on && !gValid() ? h('button', { class: 'pill-btn', title: 'Google-Kalender laden (Anmeldung erneuern)', onclick: gReload }, icon('sync', 16), 'Google laden') : null,
    h('button', { class: 'pill-btn', title: 'Abos und Google Kalender neu laden', onclick: async e => {
      const b = e.currentTarget; b.disabled = true;
      await refreshFeeds();
      if (cfg.on) { if (!gValid()) { try { await gToken(); } catch {} } cal.gcache.clear(); await gLoadRange(true); }
      b.disabled = false; render(); toast('Aktualisiert');
    } }, icon('sync', 16), 'Aktualisieren'),
    h('button', { class: 'pill-btn', onclick: openSources }, icon('gear', 16), 'Quellen'),
    h('button', { class: 'pill-btn primary', onclick: () => editEvent(null, defaultSlot()) }, icon('plus', 16), 'Termin'));
  const titlebar = headEl.querySelector('.lib-titlebar');
  headEl.replaceChildren(...(titlebar ? [titlebar] : []), h('div', { class: 'lib-toolbar cal-toolbar' }, nav, h('div', { class: 'spacer' }), actions));

  const legend = h('div', { class: 'cal-legend' },
    h('span', { class: 'cal-src' }, h('i', { style: { background: FOLIO_COLOR } }), 'Folio'),
    ...cal.records.filter(r => r.kind === 'calfeed' && !r.deleted).map(r => h('span', { class: 'cal-src' + (r.error ? ' err' : ''), title: r.error || '' }, h('i', { style: { background: r.color } }), (r.url ? 'Abo: ' : 'Import: ') + r.name, r.error ? ' ⚠' : '')),
    ...(cfg.on ? Object.values(cfg.cals).filter(c => c.on).map(c => h('span', { class: 'cal-src' }, h('i', { style: { background: c.color } }), 'Google: ' + calName(c))) : []),
    cal.gerr ? h('span', { class: 'cal-src err' }, '⚠ ' + cal.gerr) : null);
  (month ? drawMonth : drawWeek)(legend, rangeItems());
}

function drawWeek(legend, items) {
  const ws = cal.ws;
  const today = ymd(new Date());
  const days = Array.from({ length: 7 }, (_, i) => dayAt(ws, i));
  const dayStart = days.map(d => d.getTime()), dayEnd = days.map((d, i) => dayAt(ws, i + 1).getTime());
  // all-day row: all-day events, and the whole days a longer timed event covers — one bar across the days
  const inBar = (o, i) => o.allDay || (o.end - o.start >= 86400000 && o.start <= dayStart[i] && o.end >= dayEnd[i]);
  const timed = days.map(() => []);
  for (const o of items) {
    days.forEach((d, i) => {
      if (!overlaps(o, dayStart[i], dayEnd[i]) || inBar(o, i)) return;
      timed[i].push({ o, s: Math.max(o.start, dayStart[i]), e: Math.max(Math.min(o.end, dayEnd[i]), Math.max(o.start, dayStart[i]) + 15 * 60000) });
    });
  }
  const evBtn = (o, style, cls = '') => h('button', {
    class: 'cal-ev ' + cls, style: { '--ec': o.color, ...style }, title: `${o.title} · ${fmtWhen(o)} · ${o.srcName}`,
    onclick: e => { e.stopPropagation(); openItem(o); },
  }, h('span', { class: 'cal-ev-title' }, o.title), h('span', { class: 'cal-ev-time' }, `${fmtTime(o.start)}–${fmtTime(o.end)}`));

  const heads = h('div', { class: 'cal-row cal-heads' }, h('div', { class: 'cal-gutter' }),
    ...days.map(d => h('div', { class: 'cal-dayhead' + (ymd(d) === today ? ' today' : '') },
      h('span', { class: 'cal-dow' }, d.toLocaleDateString('de-DE', { weekday: 'short' })), h('span', { class: 'cal-dnum' }, d.getDate()))));
  const segs = barSegs(items, dayStart, dayEnd, inBar);
  const n = lanes(segs);
  const alldayRow = n ? h('div', { class: 'cal-row cal-allday', style: { gridTemplateRows: `repeat(${n}, 24px)` } },
    h('div', { class: 'cal-gutter', style: { gridRow: '1 / -1' } }, 'ganztägig'),
    ...days.map((d, i) => h('div', { class: 'cal-adcell', style: { gridColumn: String(i + 2), gridRow: '1 / -1' } })),
    ...segs.map(s => barBtn(s, 2, s.lane + 1))) : null;

  const cols = days.map((d, i) => {
    const col = h('div', { class: 'cal-col' + (ymd(d) === today ? ' today' : ''), 'data-day': ymd(d) });
    for (const x of layout(timed[i])) {
      const top = (x.s - dayStart[i]) / 3600000 * HOUR, height = Math.max(18, (x.e - x.s) / 3600000 * HOUR - 2);
      // overlapping events share the column but stay readable: each one is wider than its share
      // and the later ones lie on top (like Google Calendar)
      const left = x.col / x.n * 100, width = x.col === x.n - 1 ? 100 / x.n : Math.min(100 - left, 100 / x.n * 1.7);
      col.append(evBtn(x.o, { top: top + 'px', height: height + 'px', left: `calc(${left}% + 1px)`, width: `calc(${width}% - 3px)`, zIndex: 1 + x.col }, (height < 34 ? 'short' : '') + (x.n > 1 ? ' stacked' : '')));
    }
    if (ymd(d) === today) { const now = new Date(); col.append(h('div', { class: 'cal-now', style: { top: (now.getHours() + now.getMinutes() / 60) * HOUR + 'px' } })); }
    // tap on free time → new event there (30-minute steps)
    col.addEventListener('click', e => {
      if (e.target !== col) return;
      const y = e.offsetY, mins = Math.max(0, Math.min(23 * 60 + 30, Math.floor(y / HOUR * 2) * 30));
      editEvent(null, { date: ymd(d), start: `${pad(mins / 60 | 0)}:${pad(mins % 60)}`, end: hourLater(mins) });
    });
    return col;
  });
  const hours = h('div', { class: 'cal-hours' }, Array.from({ length: 24 }, (_, i) => h('div', { class: 'cal-hour', style: { top: i * HOUR + 'px' } }, i ? `${pad(i)}:00` : '')));
  const body = h('div', { class: 'cal-body', style: { height: 24 * HOUR + 'px' } }, hours, ...cols);
  const scroller = h('div', { class: 'cal-scroll' }, body);
  scroller.addEventListener('scroll', () => { cal.scroll = scroller.scrollTop; });

  bodyEl.replaceChildren(h('div', { class: 'cal' }, legend, h('div', { class: 'cal-grid' }, heads, alldayRow, scroller)));
  // first view: this week → the current time in the upper third; other weeks → from 7:00 (or the earliest event)
  const now = new Date(), earliest = Math.min(...timed.flat().map(x => new Date(x.s).getHours()), 7);
  const first = days.some(d => ymd(d) === today)
    ? (now.getHours() + now.getMinutes() / 60) * HOUR - scroller.clientHeight / 3
    : (earliest - 0.5) * HOUR;
  scroller.scrollTop = cal.scroll ?? Math.max(0, first);
}

// Month (like Apple Calendar): 6 weeks; all-day and multi-day events as bars across the days,
// the others as "• 10:00 Title"; what does not fit is "+3 weitere" (→ that week).
// cal.mLines (lines per day) follows the height of the rows: measured after drawing.
function drawMonth(legend, items, again = false) {
  const gs = weekStartOf(cal.month), m = new Date(cal.month).getMonth();
  const today = ymd(new Date());
  const L = cal.mLines, ROW = 1; // grid row of the day numbers; event lines start below
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const days = Array.from({ length: 7 }, (_, i) => dayAt(gs, w * 7 + i));
    const ds = days.map(d => d.getTime()), de = days.map((d, i) => dayAt(gs, w * 7 + i + 1).getTime());
    const inWeek = items.filter(o => overlaps(o, ds[0], de[6]));
    // bars: all-day events and ones of a day or longer; a short one over midnight is a line on its first day
    const isBar = o => o.allDay || (multiDay(o) && o.end - o.start >= 86400000);
    const startsOn = (o, i) => (o.start >= ds[i] && o.start < de[i]) || (i === 0 && o.start < ds[0]);
    const segs = barSegs(inWeek.filter(isBar), ds, de, () => true);
    lanes(segs);
    // per day: lanes taken by bars, then the other events in the free lanes, by time
    const used = days.map((_, i) => new Set(segs.filter(s => s.a <= i && i <= s.b).map(s => s.lane)));
    const singles = days.map((_, i) => inWeek.filter(o => !isBar(o) && startsOn(o, i)).sort((a, b) => a.start - b.start)
      .map(o => { let l = 0; while (used[i].has(l)) l++; used[i].add(l); return { o, lane: l }; }));
    const lim = days.map((_, i) => (Math.max(-1, ...used[i]) >= L ? L - 1 : L)); // one line less when "+N" is needed
    const hidden = days.map(() => 0);
    const cells = days.map((d, i) => {
      const other = d.getMonth() !== m, we = i >= 5;
      const cell = h('div', { class: 'calm-day' + (other ? ' other' : '') + (we ? ' weekend' : '') + (ymd(d) === today ? ' today' : ''), style: { gridColumn: String(i + 1), gridRow: '1 / -1' } },
        h('button', { class: 'calm-num', title: 'Woche zeigen', onclick: e => { e.stopPropagation(); setView('week', weekStartOf(d)); } }, d.getDate() === 1 ? d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' }) : String(d.getDate())));
      // tap on free space → new event that day
      cell.addEventListener('click', e => { if (e.target === cell) editEvent(null, slotOn(ymd(d))); });
      return cell;
    });
    const out = [];
    for (const s of segs) { // a bar is drawn on the days where its lane fits, as one piece per run of days
      let a = -1;
      for (let i = s.a; i <= s.b + 1; i++) {
        const fits = i <= s.b && s.lane < lim[i];
        if (i <= s.b && !fits) hidden[i]++;
        if (fits && a < 0) a = i;
        if (!fits && a >= 0) { out.push(barBtn(s, 1, ROW + 1 + s.lane, a, i - 1)); a = -1; }
      }
    }
    days.forEach((d, i) => {
      for (const x of singles[i]) {
        if (x.lane >= lim[i]) { hidden[i]++; continue; }
        const o = x.o;
        out.push(h('button', {
          class: 'calm-ev', style: { '--ec': o.color, gridColumn: String(i + 1), gridRow: String(ROW + 1 + x.lane) },
          title: `${o.title} · ${fmtWhen(o)} · ${o.srcName}`, onclick: e => { e.stopPropagation(); openItem(o); },
        }, h('i'), h('span', { class: 'calm-time' }, fmtTime(o.start)), h('span', { class: 'calm-title' }, o.title)));
      }
      if (hidden[i]) out.push(h('button', {
        class: 'calm-more', style: { gridColumn: String(i + 1), gridRow: String(ROW + 1 + L - 1) },
        onclick: e => { e.stopPropagation(); setView('week', weekStartOf(d)); },
      }, `+${hidden[i]} weitere`));
    });
    weeks.push(h('div', { class: 'calm-week', style: { gridTemplateRows: `26px repeat(${L}, 20px)` } }, ...cells, ...out));
  }
  const heads = h('div', { class: 'calm-heads' }, ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((x, i) => h('div', { class: i >= 5 ? 'weekend' : '' }, x)));
  const grid = h('div', { class: 'cal-grid calm' }, heads, h('div', { class: 'calm-weeks' }, weeks));
  bodyEl.replaceChildren(h('div', { class: 'cal' }, legend, grid));
  // as many lines per day as the row height holds (the window decides): redraw once if that changed
  const rowH = weeks[0].getBoundingClientRect().height;
  const fit = Math.max(1, Math.floor((rowH - 28) / 21));
  if (rowH && fit !== cal.mLines && !again) { cal.mLines = fit; drawMonth(legend, items, true); }
}
addEventListener('resize', () => { if (cal.view === 'month' && bodyEl?.querySelector('.calm')) render(); });

// an hour after mins (minutes of the day), at most 23:59 (the same day)
const hourLater = mins => (mins + 60 >= 24 * 60 ? '23:59' : `${pad((mins + 60) / 60 | 0)}:${pad(mins % 60)}`);
function slotOn(date) {
  const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
  const s = date === ymd(new Date()) && d.getDate() === new Date().getDate() ? d.getHours() : 9;
  return { date, start: `${pad(s)}:00`, end: hourLater(s * 60) };
}
function defaultSlot() {
  if (cal.view === 'month') return slotOn(monthStartOf(Date.now()) === cal.month ? ymd(new Date()) : ymd(new Date(cal.month)));
  const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
  const ws = cal.ws, inWeek = d.getTime() >= ws && d.getTime() < dayAt(ws, 7).getTime();
  const date = inWeek ? ymd(d) : ymd(new Date(ws));
  const s = inWeek ? d.getHours() : 9;
  return { date, start: `${pad(s)}:00`, end: hourLater(s * 60) };
}

// ---------- Event sheets ----------
function openItem(o) {
  if (o.editable) return editEvent(o);
  const when = fmtWhen(o);
  sheet({
    title: 'Termin', done: 'OK', cancel: false,
    body: h('div', { class: 'cal-detail' },
      h('div', { class: 'cal-detail-title' }, o.title),
      h('div', {}, when),
      o.location ? h('div', {}, '📍 ' + o.location) : null,
      o.description ? h('div', { class: 'cal-desc' }, o.description) : null,
      h('div', { class: 'cal-detail-src' }, h('i', { style: { background: o.color } }), 'Quelle: ' + o.srcName + ' (nur lesbar)'),
      o.unsupported ? h('div', { class: 'cal-note' }, 'Die Wiederholungsregel dieses Termins wird nicht vollständig unterstützt – gezeigt wird nur der erste Termin.') : null),
  });
}

// o: occurrence to edit, or null for a new event (slot: { date, start, end })
async function editEvent(o, slot) {
  const isNew = !o;
  const cfg = gcfg();
  const r = o?.source === 'folio' ? o.rec : null;
  // all-day: the end is exclusive (next midnight) — the sheet shows the last day
  const v = isNew ? { title: '', endDate: slot.date, allDay: false, ...slot, repeat: 'none', until: '' }
    : { title: o.title, date: ymd(new Date(o.start)), endDate: ymd(new Date(o.allDay ? Math.max(o.start, o.end - 86400000) : o.end)), allDay: !!o.allDay,
      start: o.allDay ? '09:00' : hm(new Date(o.start)), end: o.allDay ? '10:00' : hm(new Date(o.end)), repeat: r?.weekly ? 'weekly' : 'none', until: r?.until || '' };
  let scope = 'one', action = 'save';
  let target = isNew ? (cfg.on && writable(cfg.cals[cfg.target]) ? cfg.target : 'folio') : null;
  const title = h('input', { class: 'field big', placeholder: 'Titel', value: v.title });
  const date = h('input', { class: 'field', type: 'date', value: v.date });
  const endDate = h('input', { class: 'field', type: 'date', value: v.endDate });
  const start = h('input', { class: 'field', type: 'time', value: v.start, step: 300 });
  const end = h('input', { class: 'field', type: 'time', value: v.end, step: 300 });
  // moving the start day moves the end day along (the length stays)
  let prevDate = v.date;
  date.addEventListener('change', () => {
    if (date.value && prevDate && endDate.value) endDate.value = addDays(endDate.value, daysBetween(prevDate, date.value));
    prevDate = date.value;
  });
  let allDay = v.allDay;
  const showTimes = () => { start.hidden = end.hidden = allDay; };
  const allDayRow = toggle('Ganztägig', allDay, x => { allDay = x; showTimes(); });
  showTimes();
  const until = h('input', { class: 'field', type: 'date', value: v.until });
  const untilRow = h('div', { class: 'cal-until', hidden: v.repeat !== 'weekly' }, h('span', { class: 'form-label' }, 'Wiederholen bis (optional)'), until);
  let repeat = v.repeat;
  const recurring = !isNew && o.recurring;
  const targets = [['folio', 'Folio'], ...Object.entries(cfg.on ? cfg.cals : {}).filter(([, c]) => writable(c)).map(([id, c]) => [id, 'Google: ' + calName(c)])];
  const targetSel = isNew && targets.length > 1 ? h('select', { class: 'field', onchange: e => { target = e.target.value; } }, targets.map(([id, l]) => { const op = h('option', { value: id }, l); op.selected = id === target; return op; })) : null;
  const canRepeat = isNew || (o.source === 'folio' && (!recurring || scope === 'all'));
  const repeatCtl = segmented([['none', 'Einmalig'], ['weekly', 'Wöchentlich']], repeat, x => { repeat = x; untilRow.hidden = x !== 'weekly'; });
  const repeatWrap = h('div', { hidden: !canRepeat }, h('div', { class: 'form-label' }, 'Wiederholung'), repeatCtl, untilRow);
  const scopeCtl = recurring ? h('div', {}, h('div', { class: 'form-label' }, 'Ändern'), segmented([['one', 'Nur dieser Termin'], ['all', 'Ganze Serie']], scope, x => {
    scope = x;
    repeatWrap.hidden = !(o.source === 'folio' && x === 'all');
    gSeriesNote.hidden = !(o.source === 'google' && x === 'all');
  })) : null;
  const gSeriesNote = h('div', { class: 'cal-note', hidden: true }, 'Bei einer Google-Serie ändert Folio nur den Titel; Zeiten bitte pro Termin oder in Google Kalender ändern.');
  const del = !isNew ? h('button', { class: 'pill-btn danger cal-del', onclick: e => { action = 'delete'; e.currentTarget.closest('.sheet').querySelector('.textbtn.strong').click(); } }, icon('trash', 16), recurring ? 'Löschen …' : 'Löschen') : null;
  const body = h('div', { class: 'form cal-form' },
    title,
    allDayRow,
    h('div', { class: 'cal-when' },
      h('div', { class: 'form-label' }, 'Beginn'), h('div', { class: 'cal-when-row' }, date, start),
      h('div', { class: 'form-label' }, 'Ende'), h('div', { class: 'cal-when-row' }, endDate, end)),
    scopeCtl, gSeriesNote, repeatWrap,
    targetSel ? h('div', {}, h('div', { class: 'form-label' }, 'Speichern in'), targetSel) : null,
    !isNew ? h('div', { class: 'cal-detail-src' }, h('i', { style: { background: o.color } }), 'Quelle: ' + o.srcName) : null,
    del);
  const res = await sheet({
    title: isNew ? 'Neuer Termin' : 'Termin', done: 'Sichern', body,
    onDone: () => {
      if (action === 'delete') return true;
      if (!date.value || !endDate.value || (!allDay && (!start.value || !end.value))) { toast('Bitte Beginn und Ende angeben'); return false; }
      if (endDate.value < date.value) { toast('Das Ende liegt vor dem Beginn'); return false; }
      if (!allDay && endDate.value > date.value && endDate.value + end.value <= date.value + start.value) { toast('Das Ende liegt vor dem Beginn'); return false; }
      return true;
    },
  });
  if (!res) return;
  // same day with the end before the start: ends the next day (as before multi-day events)
  const ed = !allDay && endDate.value === date.value && end.value <= start.value ? addDays(date.value, 1) : endDate.value;
  const val = { title: title.value.trim() || '(ohne Titel)', date: date.value, endDate: ed, start: start.value, end: end.value, allDay, weekly: repeat === 'weekly', until: repeat === 'weekly' && until.value ? until.value : null };
  try {
    if (action === 'delete') await deleteItem(o, recurring ? await askScope() : 'all');
    else if (isNew) await createEvent(val, target);
    else if (o.source === 'folio') await saveOwn(o, val, recurring ? scope : 'all');
    else if (o.source === 'google') await saveGoogle(o, val, recurring ? scope : 'one');
  } catch (err) { toast('⚠ ' + err.message, 4000); }
  render();
}

function askScope() {
  let s = 'one';
  return sheet({ title: 'Wiederholten Termin löschen', done: 'Löschen', body: h('div', { class: 'form' }, segmented([['one', 'Nur dieser Termin'], ['all', 'Ganze Serie']], s, x => { s = x; })), onDone: () => s })
    .then(x => x || null);
}

async function createEvent(v, target) {
  const now = Date.now();
  if (target && target !== 'folio') {
    if (!gValid()) await gToken();
    const body = { summary: v.title, ...gTimes(v) };
    if (v.weekly) body.recurrence = [`RRULE:FREQ=WEEKLY${v.until ? `;UNTIL=${v.until.replace(/-/g, '')}T235959Z` : ''}`];
    await gapi(`calendars/${encodeURIComponent(target)}/events`, { method: 'POST', body: JSON.stringify(body) });
    cal.gcache.clear(); await gLoadRange(true);
    toast('In Google Kalender gespeichert');
    return;
  }
  await store.put({ kind: 'event', id: uid(), name: v.title, title: v.title, date: v.date, endDate: v.endDate, start: v.start, end: v.end, allDay: v.allDay, tz: localTz(), weekly: v.weekly, until: v.until, exceptions: {}, created: now, updated: now });
}

async function saveOwn(o, v, scope) {
  const r = o.rec;
  if (r.weekly && scope === 'one') {
    r.exceptions = { ...(r.exceptions || {}), [o.occDate]: { title: v.title, date: v.date, endDate: v.endDate, start: v.start, end: v.end, allDay: v.allDay } };
  } else {
    // whole series: a changed date moves the series by the same number of days; the length is the new one
    const shift = daysBetween(o.occDate, v.date);
    const first = shift ? addDays(r.date, shift) : r.date;
    const date = r.weekly ? first : v.date;
    Object.assign(r, { title: v.title, name: v.title, start: v.start, end: v.end, allDay: v.allDay, date, endDate: addDays(date, daysBetween(v.date, v.endDate)), weekly: v.weekly, until: v.until });
    if (!v.weekly) r.exceptions = {};
  }
  r.updated = Date.now();
  await store.put(r);
}

async function saveGoogle(o, v, scope) {
  if (!gValid()) await gToken();
  const id = scope === 'all' && o.recurringEventId ? o.recurringEventId : o.id;
  const body = scope === 'all' && o.recurringEventId ? { summary: v.title } : { summary: v.title, ...gTimes(v) };
  await gapi(`calendars/${encodeURIComponent(o.calId)}/events/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  cal.gcache.clear(); await gLoadRange(true);
}

async function deleteItem(o, scope) {
  if (!scope) return;
  if (o.source === 'folio') {
    const r = o.rec;
    if (r.weekly && scope === 'one') { r.exceptions = { ...(r.exceptions || {}), [o.occDate]: { cancelled: true } }; r.updated = Date.now(); await store.put(r); }
    else await store.put(tombstone(r));
  } else if (o.source === 'google') {
    if (!gValid()) await gToken();
    const id = scope === 'all' && o.recurringEventId ? o.recurringEventId : o.id;
    await gapi(`calendars/${encodeURIComponent(o.calId)}/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
    cal.gcache.clear(); await gLoadRange(true);
  }
  toast('Gelöscht');
}

// ---------- Sources ----------
async function openSources() {
  const cfg = gcfg();
  const wrap = h('div', { class: 'form cal-sources' });
  const fill = () => {
    const feeds = cal.records.filter(r => r.kind === 'calfeed' && !r.deleted);
    const url = h('input', { class: 'field', type: 'url', placeholder: 'https://… oder webcal://…', autocomplete: 'off', spellcheck: 'false' });
    wrap.replaceChildren(
      h('div', { class: 'form-label' }, 'Google Kalender'),
      cfg.on
        ? h('div', { class: 'cal-gcals' },
          ...Object.entries(cfg.cals).map(([id, c]) => toggle(`${calName(c)}${writable(c) ? '' : ' (nur lesen)'}`, c.on, on => { c.on = on; saveSettings(); cal.gcache.clear(); })),
          h('div', { class: 'form-label' }, 'Neue Termine standardmäßig in'),
          h('select', { class: 'field', onchange: e => { cfg.target = e.target.value; saveSettings(); } },
            [['folio', 'Folio (synchronisiert über Google Drive)'], ...Object.entries(cfg.cals).filter(([, c]) => writable(c)).map(([id, c]) => [id, 'Google: ' + calName(c)])]
              .map(([id, l]) => { const op = h('option', { value: id }, l); op.selected = cfg.target === id; return op; })),
          h('div', { class: 'cal-row-btns' },
            h('button', { class: 'pill-btn', onclick: async () => { try { await gToken(); await gListCalendars(); fill(); } catch (err) { toast('⚠ ' + err.message); } } }, icon('sync', 16), 'Kalenderliste neu laden'),
            h('button', { class: 'pill-btn danger', onclick: () => { gDisconnect(); fill(); } }, 'Trennen')))
        : h('div', {},
          h('p', { class: 'cal-hint' }, 'Zeigt deine Google-Kalender in der Wochenansicht und kann Termine dort anlegen, ändern und löschen. Google fragt dafür einmal separat um Erlaubnis (Kalenderliste lesen, Termine bearbeiten). Die Drive-Synchronisierung braucht das nicht.'),
          h('button', { class: 'pill-btn primary', onclick: async () => { await gConnect(); fill(); } }, icon('calendar', 16), 'Mit Google Kalender verbinden')),
      h('div', { class: 'form-label' }, 'Abos und importierte Kalender'),
      ...feeds.map(f => h('div', { class: 'cal-feed' },
        h('i', { style: { background: f.color } }),
        h('div', { class: 'cal-feed-main' },
          h('b', {}, f.name),
          h('span', {}, `${f.url ? 'Abo' : 'Import'} · ${(f.events || []).length} Einträge${f.fetched ? ' · Stand ' + new Date(f.fetched).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : ''}`),
          f.error ? h('span', { class: 'cal-err' }, f.error) : null),
        f.url ? h('button', { class: 'iconbtn plain', title: 'Aktualisieren', 'aria-label': 'Aktualisieren', onclick: async () => { await refreshFeedOne(f); fill(); } }, icon('sync', 18)) : null,
        h('button', { class: 'iconbtn plain', title: 'Entfernen', 'aria-label': 'Entfernen', onclick: async () => {
          if (!(await confirmBox('Kalender entfernen', `„${f.name}“ und seine Termine aus Folio entfernen?`, 'Entfernen', true))) return;
          await store.put(tombstone(f)); f.deleted = true; fill();
        } }, icon('trash', 18)))),
      h('div', { class: 'cal-sub' }, url, h('button', { class: 'pill-btn', onclick: async e => {
        if (!url.value.trim()) return;
        e.currentTarget.disabled = true;
        if (await subscribe(url.value)) { cal.records = (await store.list()).filter(r => CAL_KINDS.has(r.kind)); fill(); }
        else e.currentTarget.disabled = false;
      } }, 'Abonnieren')),
      h('p', { class: 'cal-hint' }, 'Abos werden nur beim Tippen auf „Aktualisieren“ neu geladen. Die Adresse eines privaten Kalenders ist wie ein Passwort: Sie wird nur auf deinen Geräten und in deinem Google Drive gespeichert.'),
      h('button', { class: 'pill-btn', onclick: async () => { await importFile(); cal.records = (await store.list()).filter(r => CAL_KINDS.has(r.kind)); fill(); } }, icon('download', 16), 'ICS-Datei importieren …'));
  };
  fill();
  await sheet({ title: 'Kalenderquellen', done: 'Fertig', cancel: false, body: wrap });
  render();
}
async function refreshFeedOne(f) {
  try { const p = await fetchFeed(f.url); Object.assign(f, { events: p.events, fetched: Date.now(), error: '', updated: Date.now() }); toast('Aktualisiert'); }
  catch (err) { Object.assign(f, { error: err.message, updated: Date.now() }); toast('⚠ ' + err.message, 4000); }
  await store.put(f);
}

bus.addEventListener('remote', e => { if (cal.records.some(r => r.id === e.detail)) render(); });
