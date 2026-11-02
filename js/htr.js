// Handwriting recognition (beta): makes handwritten words findable in the search.
//
// Self-contained and removable (README → „Handschrifterkennung (Beta)“): this file, htr-worker.js
// and the lines marked „HTR-Beta“ in editor.js, library.js and sw.js. Documents are never changed:
// the recognised text lives in a separate local IndexedDB ('folio-htr', per device), so sync,
// merge and export don't see it. Off by default (Einstellungen → Stift).
//
// How: pen strokes of a page are grouped into text lines (tall strokes by their vertical centre,
// dots and bars to the nearest line), long lines split at word gaps, each line drawn as a 64 px
// high image and read by DE·HTR v2 in a worker (htr-worker.js). Pages are re-read only when their
// strokes change, one line at a time, never while the pen is down. Search tolerates recognition
// errors (approximate matching), so “Felix” is found in a line read as “Felik”.
import { settings, saveSettings, store, bus } from './store.js';
import { drawStroke } from './render.js';

const H = 64, MAX_W = 1024, STRIDE = 4; // model input (config.json of the model)
export const htrOn = () => !!settings.htr;

// ---------- Index (same database as the worker's model cache) ----------
const db = () => (db.p ||= new Promise((res, rej) => {
  const r = indexedDB.open('folio-htr', 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('files'); r.result.createObjectStore('pages'); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
}));
const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('pages', mode), q = fn(t.objectStore('pages')); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); };
const getPage = key => tx('readonly', s => s.get(key));
const putPage = (key, v) => tx('readwrite', s => s.put(v, key));
const allPages = () => tx('readonly', s => s.getAll());

// ---------- Worker ----------
let worker = null, seq = 0;
const waiting = new Map();
function recognize(data, width) {
  worker ||= Object.assign(new Worker(new URL('./htr-worker.js', import.meta.url), { type: 'module' }), {
    onmessage: ({ data: m }) => { const w = waiting.get(m.line); if (!w) return; waiting.delete(m.line); m.error ? w.rej(new Error(m.error)) : w.res(m.text); },
  });
  return new Promise((res, rej) => { const line = ++seq; waiting.set(line, { res, rej }); worker.postMessage({ line, data, width }, [data.buffer]); });
}

// ---------- Lines of a page ----------
const isText = e => e.type === 'stroke' && e.tool === 'pen' && !e.shape && e.points.length;
const boxOf = s => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of s.points) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
};
export function pageLines(page) {
  const it = page.elements.filter(isText).map(s => ({ s, b: boxOf(s) }));
  if (!it.length) return [];
  const hs = it.map(i => i.b.y1 - i.b.y0).sort((a, b) => a - b), med = Math.max(1, hs[hs.length >> 1]);
  // drawings (far taller than letters) are left out
  const usable = it.filter(i => i.b.y1 - i.b.y0 <= 4 * med);
  const big = usable.filter(i => i.b.y1 - i.b.y0 >= 0.5 * med).sort((a, b) => (a.b.y0 + a.b.y1) - (b.b.y0 + b.b.y1));
  const lines = [];
  for (const i of big) {
    const cy = (i.b.y0 + i.b.y1) / 2, L = lines.find(l => cy > l.y0 && cy < l.y1);
    if (L) { L.items.push(i); L.y0 = Math.min(L.y0, i.b.y0); L.y1 = Math.max(L.y1, i.b.y1); } else lines.push({ items: [i], y0: i.b.y0, y1: i.b.y1 });
  }
  if (!lines.length) return [];
  for (const i of usable) {
    if (big.includes(i)) continue;
    const cy = (i.b.y0 + i.b.y1) / 2;
    let best = lines[0], bd = Infinity;
    for (const L of lines) { const d = cy < L.y0 ? L.y0 - cy : cy > L.y1 ? cy - L.y1 : 0; if (d < bd) { bd = d; best = L; } }
    if (bd < 2 * med) best.items.push(i);
  }
  // pieces: split at wide gaps (separate texts side by side) and where a line would be too long
  const out = [];
  for (const L of lines) {
    const items = L.items.sort((a, b) => a.b.x0 - b.b.x0), h = Math.max(1, L.y1 - L.y0);
    let cur = [], right = -Infinity;
    const flush = () => { if (cur.length) out.push(...splitLong(cur, h)); cur = []; };
    for (const i of items) { if (cur.length && i.b.x0 - right > 2.5 * h) flush(); cur.push(i); right = Math.max(right, i.b.x1); }
    flush();
  }
  return out.map(items => ({ strokes: items.map(i => i.s), box: union(items.map(i => i.b)) }));
}
const union = bs => bs.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
function splitLong(items, h) {
  const b = union(items.map(i => i.b));
  if ((b.x1 - b.x0) / h < 14 || items.length < 2) return [items];
  // split at the widest gap between consecutive strokes (a word gap)
  let at = 1, gap = -Infinity, right = items[0].b.x1;
  for (let k = 1; k < items.length; k++) { const g = items[k].b.x0 - right; if (g > gap) { gap = g; at = k; } right = Math.max(right, items[k].b.x1); }
  return [...splitLong(items.slice(0, at), h), ...splitLong(items.slice(at), h)];
}

// a line as the model's input: black ink on white, 64 px high, grey values 0..1
function lineImage(line) {
  const b = line.box, margin = 0.12, k0 = (H * (1 - 2 * margin)) / Math.max(1, b.y1 - b.y0);
  let k = k0, W = Math.ceil((b.x1 - b.x0) * k + 2 * H * margin);
  if (W > MAX_W) { k *= MAX_W / W; W = MAX_W; }
  W = Math.max(STRIDE, Math.ceil(W / STRIDE) * STRIDE);
  const c = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.setTransform(k, 0, 0, k, -b.x0 * k + H * margin, -(b.y0 + b.y1) / 2 * k + H / 2);
  const minR = 0.9 / k; // at least ~2 px wide lines, as the model saw them in training
  // as radius strokes in black (older pressure strokes: their nominal half width)
  for (const s of line.strokes) drawStroke(x, { ...s, color: '#000', rad: 1, points: s.points.map(p => [p[0], p[1], Math.max(s.rad ? p[2] : s.width / 2, minR)]) });
  const d = x.getImageData(0, 0, W, H).data, f = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) f[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  return { data: f, width: W };
}

// ---------- Background indexing ----------
const sigOf = page => { let h = 2166136261; for (const e of page.elements) if (isText(e)) for (const ch of e.id + ':' + e.points.length + ';') h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0).toString(36); };
const queue = [];
let running = false, penUntil = 0;
const listeners = new Set();
export const onHtrProgress = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const progress = () => listeners.forEach(fn => fn({ queued: queue.length, running }));
// never while writing: the pen (or a finger drawing) is down, or was just now
document.addEventListener('pointerdown', () => { penUntil = Infinity; }, true);
document.addEventListener('pointerup', () => { penUntil = performance.now() + 1500; }, true);
document.addEventListener('pointercancel', () => { penUntil = performance.now() + 1500; }, true);
const idle = () => new Promise(res => { const check = () => (performance.now() > penUntil && !document.hidden ? res() : setTimeout(check, 400)); check(); });

export function htrQueue(id, first = false) {
  if (!htrOn() || !id) return;
  const at = queue.indexOf(id);
  if (at >= 0) queue.splice(at, 1);
  first ? queue.unshift(id) : queue.push(id);
  progress();
  if (!running) run();
}
async function run() {
  running = true;
  try {
    while (queue.length && htrOn()) {
      const id = queue.shift(); progress();
      const doc = await store.get(id);
      if (!doc || doc.deleted || doc.kind !== 'notebook') continue;
      for (const page of doc.pages || []) {
        if (!htrOn()) break;
        const key = id + '|' + page.id, sig = sigOf(page);
        if ((await getPage(key))?.sig === sig) continue;
        const lines = [];
        for (const line of pageLines(page)) {
          await idle();
          const img = lineImage(line);
          lines.push({ text: await recognize(img.data, img.width), ids: line.strokes.map(s => s.id) });
        }
        await putPage(key, { doc: id, page: page.id, sig, lines });
      }
    }
  } catch (e) {
    console.warn('Handschrifterkennung:', e);
    settings.htrError = String(e?.message || e);
  } finally { running = false; progress(); }
}

// ---------- Search ----------
// Is q contained in text with at most `err` typos (insert/delete/replace)? (Sellers' algorithm)
function near(text, q) {
  const err = q.length <= 3 ? 0 : q.length <= 8 ? 1 : 2;
  if (!err) return text.includes(q);
  let prev = new Array(q.length + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= text.length; i++) {
    const cur = [0];
    for (let j = 1; j <= q.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (text[i - 1] === q[j - 1] ? 0 : 1));
    if (cur[q.length] <= err) return true;
    prev = cur;
  }
  return false;
}
// hits in an open document: [{ i: page index, text, ids }]
export async function htrSearchDoc(doc, query) {
  const q = query.trim().toLowerCase();
  if (!htrOn() || q.length < 2) return [];
  const hits = [];
  for (const [i, page] of doc.pages.entries()) {
    const rec = await getPage(doc.id + '|' + page.id);
    for (const l of rec?.lines || []) if (near(l.text.toLowerCase(), q)) hits.push({ i, text: l.text, ids: l.ids });
  }
  return hits;
}
// ids of all documents with a handwritten match (library search)
export async function htrDocIds(query) {
  const q = query.trim().toLowerCase(), ids = new Set();
  if (!htrOn() || q.length < 2) return ids;
  for (const rec of await allPages()) if (rec.lines?.some(l => near(l.text.toLowerCase(), q))) ids.add(rec.doc);
  return ids;
}

// ---------- On / off ----------
export async function setHtr(on) {
  settings.htr = on; delete settings.htrError; saveSettings();
  if (on) return start();
  queue.length = 0; worker?.terminate(); worker = null;
  for (const w of waiting.values()) w.rej(new Error('aus')); waiting.clear();
}
async function start() {
  // recently opened notebooks first; later every saved change
  const recent = (await store.list()).filter(r => r.kind === 'notebook' && !r.deleted && !r.trashed).sort((a, b) => (b.opened || b.updated) - (a.opened || a.updated)).slice(0, 20);
  recent.forEach(r => htrQueue(r.id));
}
bus.addEventListener('change', e => { if (htrOn() && e.detail) htrQueue(e.detail); });
if (htrOn()) setTimeout(start, 3000); // after the app has settled
