// Tipp-Modus (tool "Tippen"): typing on a notebook page, every line on a line of the paper.
// The page's typed text is one flowing text (flow.js: model, layout, drawing). While it is
// edited, a contenteditable view lies exactly over it (same font sizes, line distance and
// baselines, see styleBlock); the canvas copy is hidden meanwhile (ed.editing.id).
// Formats as in text documents: Text, Überschrift 1–3, Zitat, Aufzählung, Nummerierung,
// Checkliste (indent with Tab or the bar), bold/italic/underline/strikethrough, colour, highlight.
// Editing ends with another tool, Esc, a tap outside the pages, or on another page — not on
// blur (menus and the iPad keyboard take the focus); finishText() in tools.js forwards to it.
import { h, uid } from './util.js';
import { icon } from './icons.js';
import { PAGE_W } from './store.js';
import { menu, toast } from './ui.js';
import { ed, commit, renderEl, renderOptions } from './editor.js';
import { pageH } from './render.js';
import { lineGrid, layoutFlow, blockFont, blockIndent, fontMetrics, listMarks, flowColors, FLOW_FONT } from './flow.js';
import { selectionOffsets, setSelectionOffsets } from './richtext.js';

const STYLES = [['p', 'Text'], ['h1', 'Überschrift 1'], ['h2', 'Überschrift 2'], ['h3', 'Überschrift 3'], ['blockquote', 'Zitat']];
const COLORS = [['Standard', null], ['Grau', '#6E6E73'], ['Rot', '#D12F2F'], ['Orange', '#E8730C'], ['Grün', '#1F8A4C'], ['Blau', '#1F4FD1'], ['Lila', '#8E3FD1']];
const MARKS = [['Keine', null], ['Gelb', '#FFF3A3'], ['Grün', '#CCFBDA'], ['Blau', '#D6EBFF'], ['Rosa', '#FFD6E8'], ['Orange', '#FFE2C2']];
const MARK_KEYS = ['bold', 'italic', 'underline', 'strikethrough', 'color', 'backgroundColor'];
const px = v => v + 'px';

// ---------- Nodes ↔ DOM ----------
function leafEl(l) {
  let n = document.createTextNode(l.text);
  if (l.bold) n = h('b', {}, n);
  if (l.italic) n = h('i', {}, n);
  if (l.underline) n = h('u', {}, n);
  if (l.strikethrough) n = h('s', {}, n);
  if (l.color || l.backgroundColor) n = h('span', { style: { ...(l.color ? { color: l.color } : {}), ...(l.backgroundColor ? { backgroundColor: l.backgroundColor } : {}) } }, n);
  return n;
}
function blockEl(b) {
  const d = h('div', { 'data-type': b.type || 'p', 'data-id': b.id || uid() });
  if (b.listStyleType) { d.dataset.list = b.listStyleType; d.dataset.indent = b.indent || 1; }
  if (b.checked) d.dataset.checked = '';
  for (const l of b.children || []) if (l.text) d.append(leafEl(l));
  if (!d.textContent) d.append(h('br'));
  return d;
}
function marksOf(el, m0) {
  const m = { ...m0 }, tag = el.tagName, s = el.style;
  if (tag === 'B' || tag === 'STRONG') m.bold = true;
  if (tag === 'I' || tag === 'EM') m.italic = true;
  if (tag === 'U') m.underline = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') m.strikethrough = true;
  if (tag === 'FONT' && el.getAttribute('color')) m.color = el.getAttribute('color');
  if (s?.color) m.color = s.color;
  if (s?.backgroundColor && s.backgroundColor !== 'transparent' && !/rgba\(.*,\s*0\)/.test(s.backgroundColor)) m.backgroundColor = s.backgroundColor;
  if (s?.fontWeight === 'bold' || +s?.fontWeight >= 600) m.bold = true;
  if (s?.fontWeight === 'normal' || +s?.fontWeight === 400) delete m.bold;
  if (s?.fontStyle === 'italic') m.italic = true;
  if (/underline/.test(s?.textDecoration || '') || /underline/.test(s?.textDecorationLine || '')) m.underline = true;
  if (/line-through/.test(s?.textDecoration || '') || /line-through/.test(s?.textDecorationLine || '')) m.strikethrough = true;
  return m;
}
function leaves(node, marks, out) {
  for (const c of node.childNodes) {
    if (c.nodeType === 3) { if (c.data) out.push({ text: c.data.replace(/​/g, ''), ...marks }); }
    else if (c.nodeType === 1) {
      if (c.tagName === 'BR') { if (c !== node.lastChild) out.push({ text: '\n', ...marks }); }
      else if (c.tagName === 'DIV' || c.tagName === 'P') { if (out.length) out.push({ text: '\n', ...marks }); leaves(c, marks, out); }
      else leaves(c, marksOf(c, marks), out);
    }
  }
  return out;
}
function mergeLeaves(ls) {
  const out = [];
  for (const l of ls) {
    const last = out[out.length - 1];
    if (last && MARK_KEYS.every(k => last[k] === l[k])) last.text += l.text; else out.push({ ...l });
  }
  const kept = out.filter(l => l.text).map(l => Object.fromEntries(Object.entries(l).filter(([k, v]) => k === 'text' || v)));
  return kept.length ? kept : [{ text: '' }];
}
function parseBlock(d, seen) {
  let id = d.dataset?.id;
  if (!id || seen.has(id)) id = uid(); // the browser copies attributes when it splits a line
  seen.add(id);
  const type = STYLES.some(([t]) => t === d.dataset?.type) ? d.dataset.type : 'p';
  const b = { type, id };
  if (d.dataset?.list && type === 'p') { b.listStyleType = d.dataset.list; b.indent = +d.dataset.indent || 1; if (b.listStyleType === 'todo' && d.hasAttribute('data-checked')) b.checked = true; }
  b.children = mergeLeaves(leaves(d, {}, []));
  return b;
}
function parse(box) {
  const seen = new Set(), out = [];
  let loose = null;
  for (const c of [...box.childNodes]) {
    if (c.nodeType === 1 && c.tagName === 'DIV') { loose = null; out.push(parseBlock(c, seen)); continue; }
    if (c.nodeType === 3 && !c.data) continue;
    // text typed straight into the box (after deleting everything): its own paragraph
    if (!loose) { loose = h('div'); out.push(loose); }
    loose.append(c.cloneNode(true));
  }
  return out.map(b => (b instanceof HTMLElement ? parseBlock(b, seen) : b));
}
const blockText = b => (b.children || []).map(c => c.text || '').join('');
const isEmpty = b => !blockText(b) && !b.listStyleType;

// ---------- Placing the editing view ----------
// Baseline of a line inside its line box as CSS puts it (half-leading), shifted (top) so it lands
// where flow.js draws it: one line distance per line, g.off above the ruling.
function styleBlock(st, d, meta, mark) {
  const g = st.g, k = st.k, f = blockFont(meta, g), x0 = blockIndent(meta, g), m = fontMetrics(f.size, f.bold);
  const L = f.rows * g.pitch, cssBase = (L - (m.a + m.d)) / 2 + m.a, delta = L - g.off - cssBase;
  Object.assign(d.style, { fontSize: px(f.size * k), fontWeight: f.bold ? '700' : '400', lineHeight: px(L * k), paddingLeft: px(x0 * k), top: px(delta * k) });
  d.style.setProperty('--mx', px((x0 - g.istep) * k));
  d.style.setProperty('--mw', px(g.istep * k));
  d.style.setProperty('--qt', px((g.pitch * 0.22 - delta) * k));
  d.style.setProperty('--qb', px((g.pitch * 0.04 + delta) * k));
  if (meta.listStyleType === 'todo') {
    const s = Math.round(f.size * 0.82 * 10) / 10;
    d.style.setProperty('--bs', px(s * k));
    d.style.setProperty('--bl', px((x0 - g.istep + (g.istep - s) / 2) * k));
    d.style.setProperty('--bt', px((cssBase - s * 0.86) * k));
  }
  if (mark) d.dataset.mark = mark; else delete d.dataset.mark;
}
const metaOf = d => ({ type: d.dataset.type || 'p', listStyleType: d.dataset.type === 'p' || !d.dataset.type ? d.dataset.list : undefined, indent: +d.dataset.indent || 1 });
function restyle(st) {
  const ds = [...st.box.children].filter(d => d.tagName === 'DIV');
  const metas = ds.map(metaOf), marks = listMarks(metas);
  ds.forEach((d, i) => styleBlock(st, d, metas[i], marks[i]));
}

// ---------- Session ----------
export function typeAt(pageEl, pt, cx, cy) {
  const page = pageEl._page;
  if (page.inf) return toast('Tippen geht auf Seiten mit fester Größe, nicht auf unendlichen');
  let st = ed.editing; // a text box being edited was closed by the caller (tools.js)
  if (st?.flow && st.page !== page) { st.finish(); st = null; }
  if (!st?.flow) st = openFlow(pageEl);
  placeCaret(st, pt, cx, cy);
}

function openFlow(pageEl) {
  const page = pageEl._page, g = lineGrid(page);
  const all = page.elements.filter(e => e.type === 'flow'); // a sync conflict can leave two: they are joined
  const blocks = all.flatMap(e => e.blocks || []);
  const box = h('div', {
    class: 'flow-editor', contenteditable: 'true', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Getippter Text',
    autocapitalize: 'sentences',
  });
  const st = {
    flow: true, page, pageEl, g, box, all, sel: null, warned: false,
    id: all.length > 1 ? new Set(all.map(e => e.id)) : all[0]?.id, elId: all[0]?.id || uid(),
    place() {
      st.k = pageEl.clientWidth / PAGE_W;
      const C = flowColors(page.paper === 'dark');
      Object.assign(box.style, {
        left: g.left / PAGE_W * 100 + '%', top: (g.first - g.pitch) / pageH(page) * 100 + '%', width: (g.right - g.left) / PAGE_W * 100 + '%',
        fontFamily: FLOW_FONT, color: C.text,
      });
      box.style.setProperty('--flow-mute', C.mute); box.style.setProperty('--flow-quote', C.quote); box.style.setProperty('--flow-bar', C.bar);
      restyle(st);
    },
    finish: () => finishFlow(st),
  };
  box.append(...blocks.map(blockEl));
  ed.editing = st;
  pageEl.append(box);
  st.place();
  box.addEventListener('keydown', e => onKey(st, e));
  box.addEventListener('input', e => onInput(st, e));
  box.addEventListener('paste', e => {
    e.preventDefault();
    const lines = (e.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n').split('\n');
    lines.forEach((l, i) => { if (i) document.execCommand('insertParagraph'); if (l) document.execCommand('insertText', false, l); });
  });
  // the box of a checklist item ticks it
  box.addEventListener('pointerdown', e => {
    const d = blockOf(st, e.target);
    if (d?.dataset.list !== 'todo') return;
    const r = d.getBoundingClientRect(), pad = parseFloat(d.style.paddingLeft) || 0;
    if (e.clientX < r.left + pad && e.clientY < r.top + parseFloat(d.style.lineHeight)) { e.preventDefault(); e.stopPropagation(); toggleCheck(st, d); }
  });
  renderEl(pageEl); // hides the canvas copy
  renderOptions();
  return st;
}

function toggleCheck(st, d) { d.toggleAttribute('data-checked'); restyle(st); }

function caretAt(cx, cy) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(cx, cy);
  const p = document.caretPositionFromPoint?.(cx, cy);
  if (!p) return null;
  const r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true);
  return r;
}
function setCaret(st, node, off) {
  const r = document.createRange(); r.setStart(node, off); r.collapse(true);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  st.box.focus({ preventScroll: true });
}
function caretToEnd(st, d) {
  const r = document.createRange(); r.selectNodeContents(d); r.collapse(false);
  // before the placeholder <br> of an empty line
  if (d.lastChild?.tagName === 'BR') { r.setStartBefore(d.lastChild); r.collapse(true); }
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  st.box.focus({ preventScroll: true });
}

// A tap on the page: inside the text → the caret goes there (a checklist box ticks); below it →
// empty lines up to the tapped line, the caret on it.
function placeCaret(st, pt, cx, cy) {
  const g = st.g, row = Math.max(0, Math.min(g.rows - 1, Math.floor((pt[1] - (g.first - g.pitch)) / g.pitch)));
  const ds = [...st.box.children].filter(d => d.tagName === 'DIV');
  const L = layoutFlow({ blocks: parse(st.box) }, g);
  if (row >= L.rows) {
    const need = row - L.rows + 1;
    let last = null;
    for (let i = 0; i < need; i++) st.box.append(last = blockEl({ type: 'p' }));
    restyle(st);
    return caretToEnd(st, last);
  }
  const bl = L.blocks.find(b => row >= b.row0 && row < b.row0 + b.rows), d = ds[L.blocks.indexOf(bl)];
  if (d.dataset.list === 'todo' && row < bl.row0 + bl.f.rows && pt[0] < g.left + bl.x0 && pt[0] > g.left + bl.x0 - g.istep) return toggleCheck(st, d);
  const r = caretAt(cx, cy);
  if (r && d.contains(r.startContainer)) return setCaret(st, r.startContainer, r.startOffset);
  caretToEnd(st, d);
}

const blockOf = (st, node) => {
  for (let n = node?.nodeType === 3 ? node.parentNode : node; n && n !== st.box; n = n.parentNode) if (n.parentNode === st.box) return n.tagName === 'DIV' ? n : null;
  return null;
};
function selectedBlocks(st) {
  const s = getSelection();
  if (!s.rangeCount || !st.box.contains(s.anchorNode)) return [];
  const r = s.getRangeAt(0), a = blockOf(st, r.startContainer), b = blockOf(st, r.endContainer);
  const all = [...st.box.children];
  if (!a) return [];
  return all.slice(all.indexOf(a), Math.max(all.indexOf(a), b ? all.indexOf(b) : 0) + 1).filter(d => d.tagName === 'DIV');
}
const atStart = (d, s) => { const r = document.createRange(); r.selectNodeContents(d); r.setEnd(s.anchorNode, s.anchorOffset); return !r.toString().length; };
const atEnd = (d, s) => { const r = document.createRange(); r.selectNodeContents(d); r.setStart(s.anchorNode, s.anchorOffset); return !r.toString().length; };

function onKey(st, e) {
  e.stopPropagation(); // the editor's shortcuts (tools, pages) don't apply while typing
  const s = getSelection(), d = selectedBlocks(st)[0];
  if (e.key === 'Escape') { e.preventDefault(); return st.finish(); }
  if (e.key === 'Tab') { e.preventDefault(); return indent(st, e.shiftKey ? -1 : 1); }
  if (e.key === 'Enter' && !e.shiftKey && d && s.isCollapsed) {
    // Enter in an empty list item ends the list; after a heading or quote comes normal text
    if (d.dataset.list && !d.textContent) { e.preventDefault(); delete d.dataset.list; delete d.dataset.checked; delete d.dataset.indent; return changed(st); }
    if (d.dataset.type !== 'p' && atEnd(d, s)) {
      e.preventDefault();
      const n = blockEl({ type: 'p' }); d.after(n); restyle(st); return caretToEnd(st, n);
    }
  }
  if (e.key === 'Backspace' && d && s.isCollapsed && atStart(d, s) && (d.dataset.list || d.dataset.type !== 'p')) {
    // at the start of a list item / heading: first back to plain text
    e.preventDefault();
    delete d.dataset.list; delete d.dataset.checked; delete d.dataset.indent; d.dataset.type = 'p';
    return changed(st);
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); exec(st, 'bold'); }
    else if (k === 'i') { e.preventDefault(); exec(st, 'italic'); }
    else if (k === 'u') { e.preventDefault(); exec(st, 'underline'); }
  }
}

function onInput(st, e) {
  // typed straight into the box (after deleting everything): back into a line of its own
  if ([...st.box.childNodes].some(c => c.nodeType === 3 ? c.data : c.tagName !== 'DIV')) {
    const o = selectionOffsets(st.box);
    st.box.replaceChildren(...parse(st.box).map(blockEl));
    if (o) setSelectionOffsets(st.box, o[0], o[1]);
  }
  // a new list item starts unticked
  if (e.inputType === 'insertParagraph') { const d = selectedBlocks(st)[0]; if (d) delete d.dataset.checked; }
  changed(st);
}
function changed(st) {
  restyle(st);
  clearTimeout(st.checkT);
  st.checkT = setTimeout(() => {
    if (ed.editing !== st || st.warned) return;
    if (layoutFlow({ blocks: parse(st.box) }, st.g).rows > st.g.rows) { st.warned = true; toast('Die Seite ist voll: der Text reicht über die letzte Linie hinaus'); }
  }, 400);
  updateBar(st);
}

async function finishFlow(st) {
  if (ed.editing !== st) return;
  clearTimeout(st.checkT);
  const blocks = parse(st.box);
  while (blocks.length && isEmpty(blocks[blocks.length - 1])) blocks.pop(); // empty lines at the end are not kept
  ed.editing = null;
  st.box.remove();
  renderOptions();
  const page = st.page, others = page.elements.filter(e => !st.all.includes(e));
  if (!blocks.length) {
    if (st.all.length) commit(page, others); else renderEl(st.pageEl);
    return;
  }
  const el = { id: st.elId, type: 'flow', blocks };
  if (st.all.length === 1 && JSON.stringify(st.all[0]) === JSON.stringify(el)) return renderEl(st.pageEl);
  commit(page, [el, ...others]); // first in the list: typed text lies under handwriting
}

// ---------- Commands ----------
function saveRange(st) {
  const s = getSelection();
  if (s.rangeCount && st.box.contains(s.anchorNode)) st.range = s.getRangeAt(0).cloneRange();
}
function restoreRange(st) {
  const s = getSelection();
  if (document.activeElement === st.box && s.rangeCount && st.box.contains(s.anchorNode)) return;
  if (st.range) { s.removeAllRanges(); s.addRange(st.range); }
  st.box.focus({ preventScroll: true });
}
function exec(st, cmd, value) {
  restoreRange(st);
  const css = cmd === 'foreColor' || cmd === 'hiliteColor';
  if (css) document.execCommand('styleWithCSS', false, true);
  document.execCommand(cmd, false, value);
  if (css) document.execCommand('styleWithCSS', false, false);
  changed(st);
}
function setType(st, type) {
  restoreRange(st);
  for (const d of selectedBlocks(st)) { d.dataset.type = type; if (type !== 'p') { delete d.dataset.list; delete d.dataset.checked; delete d.dataset.indent; } }
  changed(st);
}
function toggleList(st, kind) {
  restoreRange(st);
  const ds = selectedBlocks(st);
  const on = ds.length && ds.every(d => d.dataset.list === kind);
  for (const d of ds) {
    d.dataset.type = 'p';
    if (on) { delete d.dataset.list; delete d.dataset.checked; delete d.dataset.indent; }
    else { d.dataset.list = kind; d.dataset.indent ||= 1; if (kind !== 'todo') delete d.dataset.checked; }
  }
  changed(st);
}
function indent(st, delta) {
  restoreRange(st);
  const ds = selectedBlocks(st).filter(d => d.dataset.list);
  for (const d of ds) d.dataset.indent = Math.max(1, Math.min(6, (+d.dataset.indent || 1) + delta));
  if (ds.length) changed(st);
}

// ---------- Format bar (tool options) ----------
let bar = null;
function fbtn(st, title, content, onclick) {
  // pointerdown would take the focus (and the selection) away from the text
  return h('button', { class: 'iconbtn td-fbtn', title, 'aria-label': title, onpointerdown: e => { e.preventDefault(); saveRange(st); }, onclick }, content);
}
export function flowBar() {
  const st = ed.editing?.flow ? ed.editing : null;
  if (!st) { bar = null; return [h('span', { class: 'opt-hint', style: { padding: '0 8px' } }, 'Auf eine Linie tippen und schreiben – der Text liegt genau auf den Linien')]; }
  const sep = () => h('div', { class: 'opt-sep' });
  const colorMenu = (anchor, list, apply) => menu(anchor, list.map(([label, c]) => ({ label, swatch: c || 'transparent', action: () => apply(c) })));
  bar = {
    st,
    style: h('button', { class: 'opt-drop td-style', onpointerdown: e => { e.preventDefault(); saveRange(st); }, onclick: e => {
      const cur = selectedBlocks(st)[0]?.dataset.type || 'p';
      menu(e.currentTarget, STYLES.map(([t, label]) => ({ label, checked: cur === t, action: () => setType(st, t) })), { className: 'td-style-menu' });
    } }, h('span', {}, 'Text'), icon('chevronDown', 14)),
    B: fbtn(st, 'Fett (Strg+B)', h('b', {}, 'B'), () => exec(st, 'bold')),
    I: fbtn(st, 'Kursiv (Strg+I)', h('i', {}, 'I'), () => exec(st, 'italic')),
    U: fbtn(st, 'Unterstrichen (Strg+U)', h('u', {}, 'U'), () => exec(st, 'underline')),
    S: fbtn(st, 'Durchgestrichen', h('s', {}, 'S'), () => exec(st, 'strikeThrough')),
    ul: fbtn(st, 'Aufzählung', h('span', { class: 'td-glyph' }, '•≡'), () => toggleList(st, 'disc')),
    ol: fbtn(st, 'Nummerierung', h('span', { class: 'td-glyph' }, '1.'), () => toggleList(st, 'decimal')),
    todo: fbtn(st, 'Checkliste', icon('check', 20), () => toggleList(st, 'todo')),
  };
  const color = fbtn(st, 'Textfarbe', h('span', { class: 'td-color-a' }, 'A'), e => colorMenu(e.currentTarget, COLORS, c => exec(st, 'foreColor', c || flowColors(st.page.paper === 'dark').text)));
  const mark = fbtn(st, 'Markieren', icon('highlighter', 20), e => colorMenu(e.currentTarget, MARKS, c => exec(st, 'hiliteColor', c || 'transparent')));
  const out = fbtn(st, 'Ausrücken (Umschalt+Tab)', icon('chevronLeft', 18), () => indent(st, -1));
  const inn = fbtn(st, 'Einrücken (Tab)', icon('chevronRight', 18), () => indent(st, 1));
  const parts = [bar.style, sep(), bar.B, bar.I, bar.U, bar.S, color, mark, sep(), bar.ul, bar.ol, bar.todo, out, inn];
  queueMicrotask(() => updateBar(st));
  return parts;
}
function updateBar(st) {
  if (!bar || bar.st !== st || !bar.style.isConnected) return;
  const d = selectedBlocks(st)[0];
  bar.style.firstChild.textContent = (STYLES.find(([t]) => t === (d?.dataset.type || 'p')) || STYLES[0])[1];
  const q = c => { try { return !!d && document.queryCommandState(c); } catch { return false; } };
  bar.B.classList.toggle('on', q('bold')); bar.I.classList.toggle('on', q('italic'));
  bar.U.classList.toggle('on', q('underline')); bar.S.classList.toggle('on', q('strikeThrough'));
  bar.ul.classList.toggle('on', d?.dataset.list === 'disc');
  bar.ol.classList.toggle('on', d?.dataset.list === 'decimal');
  bar.todo.classList.toggle('on', d?.dataset.list === 'todo');
}
document.addEventListener('selectionchange', () => { const st = ed.editing; if (st?.flow) { saveRange(st); updateBar(st); } });
