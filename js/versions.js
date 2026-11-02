// Versions of a notebook ("Durchgänge": an exercise sheet worked through a second time) and
// scripts with their flashcard decks. Both are plain records linked by id, so sync, merge,
// offload and the trash treat them like any other document; the library shows them under the
// original's tile instead of as documents of their own.
//   version:  a notebook with versionOf: <id of the original>, versionName ("Durchgang 2");
//             name and folder follow the original's
//   original: an optional versionName (shown as "Original" without one)
//   deck:     script: <id of the original notebook>; a card may point to a page of it:
//             ref: { n: page number, page?: page id in the original }
import { h } from './util.js';
import { icon } from './icons.js';
import { store, cloneNotebook } from './store.js';
import { sheet, toast, segmented, toggle } from './ui.js';
import { ensureLocal } from './offload.js';

export const rootId = r => r.versionOf || r.id;
const alive = r => r && !r.deleted && !r.trashed;
export const versionLabel = r => r.versionName || (r.versionOf ? 'Version' : 'Original');
const byName = (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true });

// The versions of r's group in a list of (light) records: the original first, then by creation.
export function versionsIn(list, r) {
  const root = rootId(r);
  return list.filter(x => alive(x) && x.kind === 'notebook' && (x.id === root || x.versionOf === root))
    .sort((a, b) => !!a.versionOf - !!b.versionOf || (a.created || 0) - (b.created || 0));
}
export const decksIn = (list, scriptId) => list.filter(x => alive(x) && x.kind === 'deck' && x.script === scriptId).sort(byName);
export const versionsOf = async r => versionsIn(await store.list(), r);

// Id of the tile r is listed under in the library (a version of a live original, a deck of a
// live script), or null. Once the original is gone, its versions show up on their own again.
export function parentTile(r, byId) {
  if (r.versionOf && alive(byId(r.versionOf))) return r.versionOf;
  if (r.kind === 'deck' && r.script && alive(byId(r.script))) return r.script;
  return null;
}

// ---------- New version ----------
// Handwriting = strokes (pen, highlighter, shapes). Text boxes, images, the paper and the PDF stay.
async function newVersion(src, blank) {
  const group = await versionsOf(src);
  const root = group[0] || src;
  const full = src.pages && !src.light ? src : await ensureLocal(src);
  if (!full) return null;
  const n = Math.max(1, ...group.map(versionNo)) + 1;
  const v = cloneNotebook(full, root.name);
  for (const k of ['offloaded', 'remoteUpd', 'size', 'pageCount', 'thumb', 'conflicts', 'light', 'pdfFiles', 'versionName', 'trashed', 'trashedBy']) delete v[k];
  if (blank) for (const p of v.pages) p.elements = p.elements.filter(e => e.type !== 'stroke');
  Object.assign(v, { versionOf: root.id, versionName: `Durchgang ${n}`, parent: root.parent ?? null });
  await store.put(v);
  return v;
}

// Asks "ohne / mit Handschrift" and creates the version. Resolves to the new record or null.
export async function askNewVersion(src) {
  let blank = true;
  const body = h('div', { class: 'form' },
    segmented([[true, 'Ohne Handschrift'], [false, 'Mit Handschrift']], blank, v => { blank = v; }),
    h('div', { class: 'hint' }, 'Ohne Handschrift: Stift, Textmarker und Formen fallen weg, Textfelder, Bilder, PDF und Papier bleiben. ' +
      'Der Durchgang gehört zu diesem Dokument und erscheint in der Bibliothek nicht als eigene Datei.'));
  if (!(await sheet({ title: 'Neuer Durchgang', body, done: 'Erstellen' }))) return null;
  const v = await newVersion(src, blank);
  if (v) toast(`„${v.versionName}“ erstellt`);
  return v;
}

// An existing notebook (e.g. a copy made before there were versions) becomes the next version of
// target; versions of its own come along, its decks go to target. Resolves to a function that undoes it.
const versionNo = v => +(/(\d+)\s*$/.exec(v.versionName || '')?.[1] || 1);
export async function attachAsVersion(r, target) {
  const list = await store.list();
  let n = Math.max(1, ...versionsIn(list, target).map(versionNo)) + 1;
  const moving = [list.find(x => x.id === r.id) || r, ...list.filter(x => alive(x) && x.versionOf === r.id)];
  const decks = list.filter(x => alive(x) && x.kind === 'deck' && x.script === r.id);
  const before = [...moving, ...decks].map(x => ({ ...x })); // light records: putting them back removes the new fields again
  const now = Date.now();
  for (const v of moving) Object.assign(v, { versionOf: target.id, versionName: `Durchgang ${n++}`, name: target.name, parent: target.parent ?? null, updated: now });
  for (const d of decks) Object.assign(d, { script: target.id, updated: now });
  await store.putMany([...moving, ...decks]);
  return () => store.putMany(before.map(x => ({ ...x, updated: Date.now() })));
}

// The name of a group is the original's: renaming one renames the others too.
export async function renameGroup(r, name) {
  const now = Date.now();
  const others = (await versionsOf(r)).filter(v => v.id !== r.id && v.name !== name);
  await store.putMany(others.map(v => Object.assign(v, { name, updated: now })));
}

// ---------- Picking from a list ----------
// items: [{ id, label, sub? }]. Resolves to the chosen id, or null.
export async function pickFrom(title, items, { search = false, empty = 'Nichts zur Auswahl.' } = {}) {
  let chosen = null;
  const list = h('div', { class: 'pick-list' });
  const fill = q => list.replaceChildren(...items.filter(it => !q || it.label.toLowerCase().includes(q)).map(it => h('button', {
    class: 'pick-item' + (it.id === chosen ? ' active' : ''),
    onclick: e => { chosen = it.id; list.querySelectorAll('.pick-item').forEach(b => b.classList.toggle('active', b === e.currentTarget)); },
  }, h('span', { class: 'pick-text' }, h('span', {}, it.label), it.sub ? h('small', {}, it.sub) : null))),
  items.length ? '' : h('div', { class: 'empty' }, empty));
  fill('');
  const field = search && items.length > 6 ? h('input', { class: 'field', type: 'search', placeholder: 'Suchen…', oninput: e => fill(e.target.value.trim().toLowerCase()) }) : null;
  const ok = await sheet({ title, body: h('div', { class: 'form' }, field, list), done: 'Wählen', onDone: () => !!chosen || (toast('Bitte etwas wählen'), false) });
  return ok ? chosen : null;
}

// Notebooks that can be a script (no versions, nothing in the trash), last opened first
export async function pickScript(current) {
  const list = (await store.list()).filter(r => alive(r) && r.kind === 'notebook' && !r.versionOf)
    .sort((a, b) => (b.opened || b.updated) - (a.opened || a.updated));
  return pickFrom('Skript wählen', list.map(r => ({ id: r.id, label: r.name, sub: r.id === current ? 'aktuell zugewiesen' : `${r.pageCount ?? 0} Seiten` })),
    { search: true, empty: 'Noch keine Notizbücher.' });
}

// ---------- Export of several versions ----------
// Asks which versions (when there are several) and makes one file per version.
// format: 'pdf' or 'goodnotes'. doc: the version shown (full or light).
export async function exportVersions(doc, format) {
  const group = await versionsOf(doc);
  let chosen = [doc];
  if (group.length > 1) {
    const on = new Set([doc.id]);
    const body = h('div', { class: 'form' },
      h('div', { class: 'hint' }, 'Für jede gewählte Version entsteht eine eigene Datei.'),
      h('div', { class: 'version-picks' }, group.map(v => toggle(versionLabel(v), on.has(v.id), c => { c ? on.add(v.id) : on.delete(v.id); }))));
    const ok = await sheet({ title: format === 'pdf' ? 'Als PDF exportieren' : 'Als Goodnotes-Datei exportieren', body, done: 'Exportieren',
      onDone: () => on.size > 0 || (toast('Bitte mindestens eine Version wählen'), false) });
    if (!ok) return;
    chosen = group.filter(v => on.has(v.id)).map(v => (v.id === doc.id ? doc : v));
  }
  const named = d => (group.length > 1 ? { ...d, name: `${d.name} – ${versionLabel(d)}` } : d);
  if (chosen.length === 1) {
    const d = chosen[0].pages && !chosen[0].light ? chosen[0] : await ensureLocal(chosen[0]);
    if (!d) return;
    if (format === 'pdf') return (await import('./pdf.js')).exportPdf(named(d));
    return (await import('./goodnotes-export.js')).exportGoodnotes(named(d));
  }
  const files = [];
  try {
    for (const [i, r] of chosen.entries()) {
      toast(`Version ${i + 1} von ${chosen.length} wird exportiert …`, 0);
      const d = r.pages && !r.light ? r : await ensureLocal(r); // one at a time: only this one is loaded
      if (!d) return;
      files.push(format === 'pdf' ? await (await import('./pdf.js')).pdfFile(named(d)) : await (await import('./goodnotes-export.js')).goodnotesFile(named(d)));
    }
  } catch (err) { return toast('Export fehlgeschlagen: ' + (err.message || 'Unbekannter Fehler'), 6000); }
  await saveFiles(files);
}

// iPad/iPhone: one share sheet with all files (iOS only opens it right after a tap, so one more
// tap is asked for). Elsewhere every file is downloaded.
async function saveFiles(files) {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && navigator.canShare?.({ files })) {
    toast('', 1);
    const go = h('button', { class: 'pill-btn primary', style: { width: '100%', justifyContent: 'center', height: '44px' } }, icon('share', 16), 'Teilen / Sichern…');
    const body = h('div', { class: 'form' },
      h('div', {}, `${files.length} Dateien sind fertig:`),
      h('ul', { class: 'version-files' }, files.map(f => h('li', {}, f.name))),
      go);
    const done = sheet({ title: 'Export', body, done: null });
    go.onclick = async () => {
      try { await navigator.share({ files }); } catch (err) { if (err.name !== 'AbortError') toast('Teilen nicht möglich: ' + err.message, 5000); }
      go.closest('.sheet')?.querySelector('.sheet-head .textbtn')?.click();
    };
    return done;
  }
  for (const f of files) {
    const a = h('a', { href: URL.createObjectURL(f), download: f.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    await new Promise(r => setTimeout(r, 400)); // browsers drop downloads started in the same moment
  }
  toast(`${files.length} Dateien exportiert`);
}

// ---------- Flashcards from a script ----------
// A deck for the script doc belongs to: the only one, one picked, or a new one (saved together
// with its first card). Resolves to a deck record (maybe not stored yet) or null.
async function deckForScript(doc) {
  const list = await store.list();
  const root = list.find(r => r.id === rootId(doc)) || doc;
  const decks = decksIn(list, root.id);
  if (decks.length === 1) return store.get(decks[0].id);
  if (decks.length) {
    const id = await pickFrom('In welchen Stapel?', decks.map(d => ({ id: d.id, label: d.name, sub: `${d.cardCount ?? 0} Karten` })));
    return id && store.get(id);
  }
  const { newDeck } = await import('./deck.js');
  return Object.assign(newDeck({ name: `${root.name} – Karteikarten`, parent: root.parent ?? null }), { script: root.id });
}

// A card from an area of a page: the area as a picture on one side, linked to the page.
export async function cardFromArea(doc, page, img) {
  const deck = await deckForScript(doc);
  if (!deck) return;
  const n = doc.pages.indexOf(page) + 1;
  const ref = { n, ...(doc.versionOf ? {} : { page: page.id }) };
  (await import('./deck.js')).quickCard(deck, { frontImg: img, ref });
}
