// Backups: in Google Drive (daily and on demand) and as a ZIP file.
//
// The sync keeps all devices the same, mistakes included: a document deleted, emptied or damaged
// on one device is like that everywhere seconds later. A backup keeps earlier states, apart from
// the sync:
// - Drive folder "Folio-Backups" (never read or written by sync.js) with
//   - "Daten": one file per record version (<id>@<updated>.json) and per PDF (<file id>.pdf),
//     never changed once written. A version is stored once, however many backups contain it.
//   - per backup a list "Folio-Backup <date>.json" (manifest): the record versions and PDFs that
//     make up that state. It is written last, after checking that every file it names is in
//     Drive with the expected size, and read back once: a list in Drive = a complete backup.
// - Drive copies the files on its servers (files.copy) from the sync folder, so large documents
//   and PDFs are not downloaded and uploaded again by the iPad (and documents kept only in Drive
//   are included). Only what Drive does not have in that version yet is uploaded from here.
// - Kept: one backup per day for the last 7 days, per week for 4 weeks, per month for 12 months.
//   Older lists, and data files no kept list names (older than a day, so another device's backup
//   in progress keeps its files), go to Drive's trash (restorable there for 30 days).
// - Restoring never overwrites: the chosen documents come back as copies in a new folder.
// - The ZIP file ("Als ZIP-Datei sichern") holds the same: backup.json + records/ + pdfs/, for a
//   copy outside Google Drive; it can be restored from the same way.
import { store, settings, saveSettings, emit, migrate, newFolder, APP_VERSION } from './store.js';
import { h, uid, pickFile } from './util.js';
import { icon } from './icons.js';
import { sheet, toast, toggle } from './ui.js';
import { driveKit as D, sync, signedIn } from './sync.js';
import { filesOf } from './pdfdoc.js';

const ROOT = 'Folio-Backups', DATA = 'Daten', FOLDER = 'application/vnd.google-apps.folder';
const DAY = 864e5, AUTO_EVERY = 20 * 36e5, GC_AGE = DAY;
const enc = encodeURIComponent;
// not offered for restoring: the synced tool row and subscribed calendars (they come back by themselves)
const NO_RESTORE = new Set(['prefs', 'calfeed']);
const KIND_NAMES = { notebook: 'Notizbuch', textdoc: 'Textdokument', deck: 'Karteikarten', folder: 'Ordner', event: 'Termin' };
const pad = n => String(n).padStart(2, '0');
const stamp = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`; };
export const backupDate = t => new Date(t).toLocaleString('de-DE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function setState(s) { settings.backup = { ...(settings.backup || {}), ...s }; saveSettings(); emit('backup', settings.backup); }

// ---------- Drive helpers ----------
async function folder(name, parent) {
  const q = `name='${name}' and mimeType='${FOLDER}' and trashed=false${parent ? ` and '${parent}' in parents` : ''}`;
  const r = await (await D.gapi(`files?q=${enc(q)}&orderBy=createdTime&fields=files(id)`)).json();
  if (r.files.length) return r.files[0].id;
  return (await (await D.gapi('files?fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
  })).json()).id;
}
const copyFile = async (src, name, parent, appProperties) => (await (await D.gapi(`files/${src}/copy?fields=id`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parents: [parent], appProperties }),
})).json()).id;
// Every data file carries the size it must have (appProperties.size), checked by every backup that
// uses it, so a damaged file is never taken over by a later backup either.
const sizeProps = (bk, size) => ({ bk, ...(size != null ? { size: String(size) } : {}) });
const backupLists = root => D.listFiles(`'${root}' in parents and trashed=false`, 'id,name,appProperties')
  .then(fs => fs.filter(f => f.appProperties?.bk === 'list').map(f => ({ ...f, created: +f.appProperties.created || 0 })).sort((a, b) => b.created - a.created));
const readJson = async id => (await D.gapi(`files/${id}?alt=media`)).json();

// ---------- Which backups are kept ----------
// times: creation times, newest first. The newest per day (7 days), per week (4), per month (12),
// and always the newest of all. Pure, so it can be tested.
export function keepSet(times) {
  const keep = new Set(times.slice(0, 1));
  const day = t => new Date(t).toDateString();
  const week = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); };
  const month = t => { const d = new Date(t); return d.getFullYear() * 12 + d.getMonth(); };
  for (const [key, n] of [[day, 7], [week, 4], [month, 12]]) {
    const seen = new Set();
    for (const t of times) {
      const k = key(t);
      if (seen.has(k)) continue;
      if (seen.size >= n) break;
      seen.add(k); keep.add(t);
    }
  }
  return keep;
}

// ---------- Making a backup ----------
let running = null;
export const backupRunning = () => !!running;
export function backupNow(opts) {
  running ||= run(opts).finally(() => { running = null; });
  return running;
}

async function run({ interactive = false, progress = () => {} } = {}) {
  try {
    if (!signedIn()) throw new Error('Für Backups in Google Drive zuerst mit Google anmelden');
    await D.getToken(interactive);
    progress('Synchronisiere …');
    await sync(false); // the newest state of all devices first (skipped while a sync runs)
    progress('Sichere …');
    const root = await folder(ROOT), dir = await folder(DATA, root);
    const have = new Map((await D.listFiles(`'${dir}' in parents and trashed=false`, 'id,name')).map(f => [f.name, f]));
    // the sync folder(s): newest file per record, and the PDF files
    const app = await D.findFolders();
    const remote = new Map(), remotePdf = new Map();
    for (const f of await D.listFiles(`(${app.map(id => `'${id}' in parents`).join(' or ')}) and trashed=false`, 'id,name,size,appProperties')) {
      if (f.name.endsWith('.json')) {
        const id = f.name.slice(0, -5), upd = +(f.appProperties?.updated || 0), cur = remote.get(id);
        if (!cur || upd > cur.upd) remote.set(id, { f, upd });
      } else if (f.appProperties?.folioFile) remotePdf.set(f.appProperties.folioFile, f);
    }
    const local = new Map((await store.list()).map(r => [r.id, r]));
    const ids = new Set([...local.keys(), ...remote.keys()]);
    const records = [], pdfIds = new Set(), expect = new Set(); // Drive ids of this backup's files
    let n = 0, sent = 0;
    for (const id of ids) {
      progress(`Sichere … ${++n} von ${ids.size}`);
      let l = local.get(id);
      const r = remote.get(id);
      if (l?.deleted || (l?.offloaded && !r)) continue; // a stub without its Drive file has nothing to back up
      // the newest version: this device's, unless it is only a stub (offload.js) or Drive's is newer
      const useLocal = l && !l.offloaded && (!r || l.updated >= r.upd);
      if (!l) { // only in Drive (sync did not get it here): its details from the file
        const rec = migrate(await readJson(r.f.id));
        if (rec.deleted) continue;
        l = { ...rec, pdfFiles: filesOf(rec) };
      }
      let full = null, upd = useLocal ? l.updated : r.upd;
      if (useLocal && !have.has(`${id}@${upd}.json`)) {
        full = await store.get(id);
        if (!full || full.deleted) continue;
        upd = full.updated;
      }
      const name = `${id}@${upd}.json`;
      let file = have.get(name)?.id;
      if (!file) {
        if (full && !(r && r.upd === upd)) { // not in Drive in this version: upload from here
          const blob = new Blob([JSON.stringify(full)], { type: 'application/json' });
          file = await D.uploadBlob({ name, parents: [dir], mimeType: 'application/json', appProperties: sizeProps('rec', blob.size) }, blob);
          sent++;
        } else file = await copyFile(r.f.id, name, dir, sizeProps('rec', r.f.size));
        if (!file) throw new Error('Drive hat keine Datei-ID zurückgegeben');
        have.set(name, { id: file, name });
      }
      expect.add(file);
      const meta = full || l;
      for (const p of full ? filesOf(full) : filesOf(l)) pdfIds.add(p);
      records.push({
        id, kind: meta.kind || 'notebook', name: meta.name || '', parent: meta.parent ?? null, updated: upd, file,
        ...(meta.trashed ? { trashed: true } : {}), ...(meta.versionOf ? { versionOf: meta.versionOf } : {}),
        ...(meta.script ? { script: meta.script } : {}),
      });
    }
    const pdfs = [], missing = [];
    for (const pid of pdfIds) {
      progress('Sichere PDFs …');
      const name = `${pid}.pdf`, e = await store.getFile(pid);
      let file = have.get(name)?.id;
      if (!file) {
        const src = remotePdf.get(pid);
        if (src) file = await copyFile(src.id, name, dir, sizeProps('pdf', src.size));
        else if (e?.blob) { file = await D.uploadBlob({ name, parents: [dir], mimeType: 'application/pdf', appProperties: sizeProps('pdf', e.blob.size) }, e.blob); sent++; }
        else { missing.push(pid); continue; }
        if (!file) throw new Error('Drive hat keine Datei-ID zurückgegeben');
        have.set(name, { id: file, name });
      }
      expect.add(file);
      pdfs.push({ id: pid, name: e?.name || '', file });
    }
    // check: every file of this backup is in Drive, with the size it must have. A damaged file
    // goes to the trash (written again by the next backup); no list is written for this one.
    progress('Prüfe …');
    const now = new Map((await D.listFiles(`'${dir}' in parents and trashed=false`, 'id,size,appProperties')).map(f => [f.id, f]));
    const bad = [...expect].filter(id => { const f = now.get(id), want = f?.appProperties?.size; return !f || (want != null && f.size != null && +f.size !== +want); });
    if (bad.length) {
      for (const id of bad) if (now.has(id)) await D.trash(id).catch(() => {});
      throw new Error(`Prüfung fehlgeschlagen: ${bad.length === 1 ? 'eine Datei fehlt' : `${bad.length} Dateien fehlen`} in Drive oder ${bad.length === 1 ? 'ist' : 'sind'} unvollständig – das nächste Backup schreibt sie neu`);
    }
    const created = Date.now();
    const manifest = { format: 'folio-backup', version: 1, created, app: APP_VERSION, records, pdfs, missing };
    const listId = await D.uploadBlob({
      name: `Folio-Backup ${stamp(created)}.json`, parents: [root], mimeType: 'application/json',
      appProperties: { bk: 'list', created: String(created), count: String(records.length) },
    }, new Blob([JSON.stringify(manifest)], { type: 'application/json' }));
    const back = listId && await readJson(listId);
    if (back?.records?.length !== records.length) throw new Error('Prüfung fehlgeschlagen: die Backup-Liste ließ sich nicht zurücklesen');
    progress('Räume alte Backups auf …');
    let pruned = 0;
    try { pruned = await prune(root, dir); } catch {} // a failed clean-up never makes the backup itself fail
    const docs = records.filter(r => r.kind !== 'folder' && !NO_RESTORE.has(r.kind)).length;
    setState({ at: created, ok: true, docs, sent, missing: missing.length, msg: '' });
    return { docs, sent, missing: missing.length, pruned };
  } catch (err) {
    setState({ ok: false, failedAt: Date.now(), msg: D.syncError(err) });
    throw err;
  }
}

// Old lists to the trash, then data files no kept list names any more.
async function prune(root, dir) {
  const lists = await backupLists(root);
  const keep = keepSet(lists.map(l => l.created));
  let n = 0;
  for (const l of lists) if (!keep.has(l.created)) { await D.trash(l.id); n++; }
  if (!n) return 0;
  const used = new Set();
  for (const l of lists) if (keep.has(l.created)) {
    const m = await readJson(l.id);
    for (const e of [...m.records, ...m.pdfs]) used.add(e.file);
  }
  for (const f of await D.listFiles(`'${dir}' in parents and trashed=false`, 'id,createdTime')) {
    if (!used.has(f.id) && Date.now() - Date.parse(f.createdTime || 0) > GC_AGE) await D.trash(f.id);
  }
  return n;
}

// Once a day, after a sync went through (sync.js). Looks in Drive at most once an hour whether
// another device has made today's backup already.
export async function autoBackup() {
  if (!signedIn() || settings.autoBackup === false || running) return;
  if (Date.now() - (settings.backupCheck || 0) < 36e5) return;
  settings.backupCheck = Date.now(); saveSettings();
  try {
    const lists = await backupLists(await folder(ROOT));
    if (lists[0] && Date.now() - lists[0].created < AUTO_EVERY) {
      if (!settings.backup?.at || settings.backup.at < lists[0].created) setState({ at: lists[0].created, ok: true, docs: +lists[0].appProperties.count || 0, msg: '' });
      return;
    }
    await backupNow();
  } catch { /* shown in the settings (setState); the next sync tries again within the hour */ }
}

// ---------- ZIP file ----------
// Stored entries (PDFs and JSON hardly compress) built as Blob parts: only one entry is in memory
// at a time (for its CRC), the file itself is assembled by the browser.
async function zipBlob(entries, progress) {
  const { crc32 } = await import('./goodnotes-export.js');
  const te = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const [i, [name, blob]] of entries.entries()) {
    progress?.(i, entries.length);
    const data = new Uint8Array(await blob.arrayBuffer()), crc = crc32(data), nm = te.encode(name);
    if (offset + data.length > 0xFFFFFFF0) throw new Error('Zu groß für eine ZIP-Datei (über 4 GB)');
    const lh = new Uint8Array(30), l = new DataView(lh.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true);
    l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, data.length, true); l.setUint16(26, nm.length, true);
    parts.push(lh, nm, blob);
    const ch = new Uint8Array(46), c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true);
    c.setUint32(42, offset, true);
    central.push(ch, nm);
    offset += 30 + nm.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

// Everything on this device, plus what is kept only in Drive (loaded for the file, not kept here).
export async function zipBackup(progress = () => {}) {
  const entries = [], records = [], pdfIds = new Set(), missing = [];
  const list = (await store.list()).filter(r => !r.deleted);
  for (const [i, l] of list.entries()) {
    progress(`Sammle … ${i + 1} von ${list.length}`);
    let full = l.offloaded ? null : await store.get(l.id);
    if (!full || full.offloaded) {
      try { full = await D.fetchRecord(l.id); } catch { full = null; }
      if (!full) { missing.push(l.name || l.id); continue; }
    }
    for (const p of filesOf(full)) pdfIds.add(p);
    entries.push([`records/${l.id}.json`, new Blob([JSON.stringify(full)], { type: 'application/json' })]);
    records.push({ id: l.id, kind: full.kind || 'notebook', name: full.name || '', parent: full.parent ?? null, updated: full.updated,
      ...(full.trashed ? { trashed: true } : {}), ...(full.versionOf ? { versionOf: full.versionOf } : {}), ...(full.script ? { script: full.script } : {}) });
  }
  const pdfs = [];
  for (const pid of pdfIds) {
    progress('Sammle PDFs …');
    const e = await store.getFile(pid);
    let blob = e?.blob || null;
    if (!blob && signedIn()) { try { blob = await D.fetchFile(pid); } catch {} }
    if (!blob) { missing.push(`PDF ${e?.name || pid}`); continue; }
    entries.push([`pdfs/${pid}.pdf`, blob]);
    pdfs.push({ id: pid, name: e?.name || '' });
  }
  const created = Date.now();
  entries.unshift(['backup.json', new Blob([JSON.stringify({ format: 'folio-backup', version: 1, created, app: APP_VERSION, records, pdfs, missing })], { type: 'application/json' })]);
  const blob = await zipBlob(entries, (i, n) => progress(`Packe … ${i + 1} von ${n}`));
  const file = new File([blob], `Folio-Backup ${stamp(created)}.zip`, { type: 'application/zip' });
  return { file, missing };
}

// iPad/iPhone: share sheet (iOS opens it only right after a tap, so one more tap is asked for).
// Elsewhere a download.
async function saveFile(file) {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && navigator.canShare?.({ files: [file] })) {
    const go = h('button', { class: 'pill-btn primary', style: { width: '100%', justifyContent: 'center', height: '44px' } }, icon('share', 16), 'Teilen / Sichern…');
    const done = sheet({ title: 'Backup-Datei', body: h('div', { class: 'form' }, h('div', {}, `„${file.name}“ ist fertig. In „Dateien“ sichern, z. B. auf einem USB-Stick oder in einem anderen Cloud-Speicher als Google Drive.`), go), done: null });
    go.onclick = async () => {
      try { await navigator.share({ files: [file] }); } catch (err) { if (err.name !== 'AbortError') toast('Teilen nicht möglich: ' + err.message, 5000); }
      go.closest('.sheet')?.querySelector('.sheet-head .textbtn')?.click();
    };
    return done;
  }
  const a = h('a', { href: URL.createObjectURL(file), download: file.name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

export async function downloadZip() {
  try {
    const { file, missing } = await zipBackup(msg => toast(msg, 0));
    toast(missing.length ? `Backup-Datei fertig, ${missing.length} nicht enthalten (nur in Drive, offline?): ${missing.slice(0, 3).join(', ')}` : 'Backup-Datei fertig', missing.length ? 8000 : 2400);
    await saveFile(file);
  } catch (err) { toast('Backup-Datei fehlgeschlagen: ' + (err.message || err), 6000); }
}

// ---------- Restoring ----------
// A source: { manifest, record(entry) → full record, pdf(entry) → Blob | null }
async function driveSource(listId) {
  const manifest = await readJson(listId);
  return {
    manifest,
    record: async e => migrate(await readJson(e.file)),
    pdf: async e => new Blob([await (await D.gapi(`files/${e.file}?alt=media`)).arrayBuffer()], { type: 'application/pdf' }),
  };
}
async function zipSource(file) {
  const { unzipBlob } = await import('./goodnotes.js');
  const z = await unzipBlob(file), text = async p => new TextDecoder().decode(await z.get(p)());
  if (!z.has('backup.json')) throw new Error('Das ist keine Folio-Backup-Datei');
  const manifest = JSON.parse(await text('backup.json'));
  if (manifest.format !== 'folio-backup') throw new Error('Das ist keine Folio-Backup-Datei');
  return {
    manifest,
    record: async e => migrate(JSON.parse(await text(`records/${e.id}.json`))),
    pdf: async e => (z.has(`pdfs/${e.id}.pdf`) ? new Blob([await z.get(`pdfs/${e.id}.pdf`)()], { type: 'application/pdf' }) : null),
  };
}

// Restores the chosen records as copies (new ids) into a new folder "Wiederhergestellt <date>".
// Folders on the way to a chosen document come along; a chosen folder brings its contents.
// Links between restored records (folder, version, deck script) point to the copies; a version
// whose original is neither restored nor here any more becomes a document of its own.
export async function restore(src, chosenIds, progress = () => {}) {
  const { manifest } = src;
  const byId = new Map(manifest.records.map(e => [e.id, e]));
  const take = new Set(chosenIds);
  // a chosen folder brings everything in it
  for (let grew = true; grew;) {
    grew = false;
    for (const e of manifest.records) if (!take.has(e.id) && e.parent && take.has(e.parent) && byId.get(e.parent).kind === 'folder' && !NO_RESTORE.has(e.kind)) { take.add(e.id); grew = true; }
  }
  // and the folders on the way to each chosen item
  for (const id of [...take]) for (let p = byId.get(id)?.parent; p && byId.has(p) && !take.has(p); p = byId.get(p).parent) take.add(p);
  const map = new Map([...take].map(id => [id, uid()]));
  const here = new Map((await store.list()).filter(r => !r.deleted && !r.trashed).map(r => [r.id, r]));
  const rootDir = newFolder(`Wiederhergestellt ${new Date(manifest.created).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })}`);
  const now = Date.now(), out = [rootDir], pdfNeeded = new Set();
  let i = 0;
  for (const id of take) {
    progress(`Stelle wieder her … ${++i} von ${take.size}`);
    const rec = await src.record(byId.get(id));
    const c = { ...rec, id: map.get(id), updated: now };
    delete c.trashed; delete c.trashedBy; delete c.offloaded; delete c.remoteUpd; delete c.light;
    if (c.kind !== 'event') c.parent = map.get(rec.parent) || rootDir.id;
    if (rec.versionOf) {
      if (map.has(rec.versionOf)) c.versionOf = map.get(rec.versionOf);
      else if (!here.has(rec.versionOf)) { delete c.versionOf; delete c.versionName; }
    }
    if (rec.script && map.has(rec.script)) c.script = map.get(rec.script);
    for (const p of filesOf(c)) pdfNeeded.add(p);
    out.push(c);
  }
  // PDF originals: put back what this device has neither as a file nor as a Drive reference
  const pdfById = new Map(manifest.pdfs.map(p => [p.id, p]));
  let pdfMissing = 0;
  for (const pid of pdfNeeded) {
    const e = await store.getFile(pid);
    if (e?.blob) continue;
    const entry = pdfById.get(pid), blob = entry && await src.pdf(entry).catch(() => null);
    if (!blob) { if (!e) pdfMissing++; continue; }
    await store.putFile({ ...(e || { id: pid, name: entry.name || '', created: now }), blob, size: blob.size, uploaded: false });
  }
  await store.putMany(out);
  return { folder: rootDir, count: out.length - 1, pdfMissing };
}

// "Wiederherstellen …": pick a backup (Drive or ZIP file), then what to restore.
export async function openRestore() {
  let lists = [];
  if (signedIn()) {
    toast('Lade Backups …', 0);
    try { await D.getToken(true); lists = await backupLists(await folder(ROOT)); toast('', 1); }
    catch (err) { toast('Backups nicht erreichbar: ' + D.syncError(err), 5000); }
  }
  let chosen = null;
  const pick = h('div', { class: 'pick-list' }, lists.map(l => h('button', {
    class: 'pick-item', onclick: e => { chosen = l.id; pick.querySelectorAll('.pick-item').forEach(b => b.classList.toggle('active', b === e.currentTarget)); },
  }, h('span', { class: 'pick-text' }, h('span', {}, backupDate(l.created)), h('small', {}, `${l.appProperties.count || '?'} Einträge · Google Drive`)))));
  const fromZip = h('button', { class: 'pill-btn', onclick: () => { chosen = 'zip'; pick.closest('.sheet')?.querySelector('.sheet-head .textbtn.strong')?.click(); } }, icon('archive', 16), 'Aus Backup-Datei (ZIP) …');
  const ok = await sheet({
    title: 'Backup wählen', done: 'Weiter',
    body: h('div', { class: 'form' },
      lists.length ? pick : h('div', { class: 'hint' }, signedIn() ? 'Noch kein Backup in Google Drive.' : 'Ohne Google-Anmeldung nur aus einer Backup-Datei.'),
      fromZip),
    onDone: () => !!chosen || (toast('Bitte ein Backup wählen'), false),
  });
  if (!ok) return;
  let src;
  try {
    if (chosen === 'zip') {
      const f = await pickFile('.zip,application/zip');
      if (!f) return;
      toast('Lese Backup-Datei …', 0);
      src = await zipSource(f);
    } else { toast('Lade Backup …', 0); src = await driveSource(chosen); }
    toast('', 1);
  } catch (err) { return toast('Backup nicht lesbar: ' + (D.syncError(err) || err.message), 6000); }
  const recs = src.manifest.records.filter(e => !NO_RESTORE.has(e.kind));
  const byId = new Map(recs.map(e => [e.id, e]));
  const path = e => { const p = []; for (let x = byId.get(e.parent); x && p.length < 20; x = byId.get(x.parent)) p.unshift(x.name); return p.join(' › '); };
  const full = e => [path(e), e.name].filter(Boolean).join(' › '); // a folder's contents right below it
  const docs = recs.filter(e => e.kind !== 'event').sort((a, b) => full(a).localeCompare(full(b), 'de'));
  const events = recs.filter(e => e.kind === 'event');
  const on = new Set(), rows = [];
  const row = (label, ids) => {
    const t = toggle(label, false, c => { for (const id of ids) c ? on.add(id) : on.delete(id); });
    rows.push([t.querySelector('input'), ids]);
    return t;
  };
  const all = toggle('Alles', false, c => { for (const [input, ids] of rows) { input.checked = c; for (const id of ids) c ? on.add(id) : on.delete(id); } });
  const body = h('div', { class: 'form' },
    h('div', { class: 'hint' }, `Stand vom ${backupDate(src.manifest.created)}. Die Auswahl kommt als Kopie in einen neuen Ordner „Wiederhergestellt …“; was jetzt in Folio ist, bleibt unverändert.`),
    h('div', { class: 'group-box' }, all),
    h('div', { class: 'group-box restore-list' },
      docs.map(e => {
        const t = row(e.name || 'Unbenannt', [e.id]);
        t.firstElementChild.append(h('small', { class: 'hint' }, ` ${KIND_NAMES[e.kind] || ''}${path(e) ? ' · ' + path(e) : ''}${e.trashed ? ' · Papierkorb' : ''}`));
        return t;
      }),
      events.length ? row(`Kalender-Termine (${events.length})`, events.map(e => e.id)) : null));
  const go = await sheet({ title: 'Wiederherstellen', body, done: 'Wiederherstellen', onDone: () => on.size > 0 || (toast('Bitte etwas wählen'), false) });
  if (!go) return;
  try {
    const r = await restore(src, [...on], msg => toast(msg, 0));
    toast(`${r.count} ${r.count === 1 ? 'Eintrag' : 'Einträge'} wiederhergestellt in „${r.folder.name}“${r.pdfMissing ? ` · ${r.pdfMissing} PDF fehlt im Backup` : ''}`, 6000);
  } catch (err) { toast('Wiederherstellen fehlgeschlagen: ' + (D.syncError(err) || err.message), 6000); }
}

// ---------- Settings box ----------
export function backupBox() {
  const status = h('div', { class: 'hint' });
  const show = () => {
    const b = settings.backup || {};
    const last = b.at ? `Letztes Backup: ${backupDate(b.at)}${b.docs != null ? ` · ${b.docs} Dokumente` : ''} ✓` : 'Noch kein Backup.';
    status.textContent = running ? 'Backup läuft …' : b.ok === false ? `⚠ Letztes Backup fehlgeschlagen (${backupDate(b.failedAt)}): ${b.msg} · ${last}` : last;
  };
  show();
  const now = h('button', { class: 'pill-btn', onclick: async e => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const r = await backupNow({ interactive: true, progress: m => { status.textContent = m; } });
      toast(`Backup fertig: ${r.docs} Dokumente${r.missing ? `, ${r.missing} PDF nicht gefunden` : ''}`, 4000);
    } catch (err) { toast('Backup fehlgeschlagen: ' + D.syncError(err), 6000); }
    btn.disabled = false; show();
  } }, icon('cloud', 16), 'Jetzt sichern');
  return h('div', { class: 'group-box backup-box' },
    signedIn() ? toggle('Tägliches Backup in Google Drive', settings.autoBackup !== false, v => { settings.autoBackup = v; saveSettings(); }) : null,
    signedIn() ? status : null,
    h('div', { class: 'hint' }, signedIn()
      ? 'Sichert einmal am Tag alle Notizen, Dokumente, Karteikarten, Termine und Original-PDFs in den Ordner „Folio-Backups“ in deinem Google Drive, getrennt vom Sync. Aufbewahrt werden die letzten 7 Tage, 4 Wochen und 12 Monate. Wiederhergestellt wird immer als Kopie. Für eine Kopie außerhalb von Google Drive: „Als Datei sichern“.'
      : 'Mit Google-Anmeldung sichert Folio täglich in dein Google Drive. Ohne Anmeldung: „Als Datei sichern“ und die Datei an einem sicheren Ort ablegen.'),
    h('div', { class: 'backup-btns' },
      signedIn() ? now : null,
      h('button', { class: 'pill-btn', onclick: () => downloadZip() }, icon('archive', 16), 'Als Datei sichern'),
      h('button', { class: 'pill-btn', onclick: () => { document.querySelector('.sheet-head .textbtn')?.click(); openRestore(); } }, icon('restore', 16), 'Wiederherstellen …')));
}
