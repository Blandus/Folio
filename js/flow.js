// Tipp-Modus: typed text on a notebook page that sits exactly on the paper's lines.
// One flowing text per page, stored as an element of the page:
//   { type: 'flow', id, blocks: [node] }
// The blocks use the node model of text documents (textdoc.js): { type: p | h1 | h2 | h3 |
// blockquote, id, listStyleType? (disc | decimal | todo), indent?, checked?, children: [{ text,
// bold?, italic?, underline?, strikethrough?, color?, backgroundColor? }] }.
// Every line of text takes one line of the paper (Überschrift 1 two), its baseline a little
// above the ruling. This module only lays out and draws (canvas: render.js, PDF export); the
// editing view (typing.js) places its lines with the same numbers, so text doesn't move when
// editing starts or ends.
import { PAGE_W } from './store.js';

export const FLOW_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';
const measure = document.createElement('canvas').getContext('2d');
const r1 = v => Math.round(v * 10) / 10;

// Paper width in points for a page of PAGE_W × h units: A4 or Letter, portrait or landscape.
export function pagePt(h) {
  const r = h / PAGE_W, near = (a, b, c) => Math.abs(a - b) < Math.abs(a - c);
  return r >= 1 ? (near(r, 11 / 8.5, 841.89 / 595.28) ? 612 : 595.28) : (near(1 / r, 11 / 8.5, 841.89 / 595.28) ? 792 : 841.89);
}

// The ruling of a page (must match drawTemplate in render.js): distance of the lines (pitch), y of
// the first line text can sit on, the text area left…right, the last usable line, and the indent
// step of lists. Papers without lines (blank, PDF, pictures) get invisible lines like "Liniert".
export function lineGrid(page) {
  const h = page.h || 1414;
  const grid = (pitch, first, left, right, bottom) => {
    const rows = Math.max(1, Math.floor((bottom - first) / pitch) + 1);
    return { pitch, first, left, right, rows, istep: pitch >= 30 ? 40 : 2 * pitch, off: r1(pitch * 0.18) };
  };
  switch (page.template) {
    case 'lined': return grid(40, 120, 112, PAGE_W - 40, h - 31);
    case 'narrow': return grid(30, 100, 102, PAGE_W - 40, h - 31);
    case 'notepad': return grid(40, 190, 112, PAGE_W - 40, h - 31);
    case 'cornell': return grid(40, 160, 296, PAGE_W - 40, h - Math.round(h * 0.2) - 1);
    case 'twocol': case 'threecol': return grid(40, 120, 60, PAGE_W - 60, h - 31);
    case 'grid': { // Goodnotes "Kariert": a line every 16 pt, the first at 15.5 pt (render.js)
      const u = PAGE_W / pagePt(h), g = 16 * u, f = 15.5 * u;
      return grid(g, f + 2 * g, f + 2 * g + 0.5 * u, f + Math.floor((PAGE_W - f - 2 * g) / g) * g, h - g);
    }
    case 'dots': return grid(25, 75, 50, PAGE_W - 50, h - 26);
    default: return grid(40, 120, 80, PAGE_W - 80, h - 60);
  }
}

// Size and line count of a block's text (headings bold; Überschrift 1 takes two lines).
export function blockFont(b, g) {
  const body = Math.max(g.pitch * 0.5, Math.min(g.pitch * 0.62, 17));
  if (b.type === 'h1') return { size: r1(Math.min(g.pitch * 1.15, body * 2.3)), rows: 2, bold: true };
  if (b.type === 'h2') return { size: r1(Math.min(g.pitch * 0.8, body * 1.45)), rows: 1, bold: true };
  if (b.type === 'h3') return { size: r1(body * 1.15), rows: 1, bold: true };
  return { size: r1(body), rows: 1, bold: false };
}
// Where a block's text starts, from the left of the text area (lists: one step per level, the
// marker stands in the step before the text).
export function blockIndent(b, g) {
  if (b.listStyleType) return (b.indent || 1) * g.istep;
  if (b.type === 'blockquote') return r1(g.istep * 0.6);
  return 0;
}
export const fontOf = s => `${s.italic ? 'italic ' : ''}${s.bold ? '700' : '400'} ${s.size}px ${FLOW_FONT}`;

// Font ascent and descent as CSS uses them to place a baseline in a line box.
const metricCache = new Map();
export function fontMetrics(size, bold) {
  const key = size + (bold ? 'b' : '');
  let m = metricCache.get(key);
  if (!m) {
    measure.font = fontOf({ size, bold });
    const t = measure.measureText('Hg');
    m = { a: t.fontBoundingBoxAscent ?? size * 0.95, d: t.fontBoundingBoxDescent ?? size * 0.24 };
    metricCache.set(key, m);
  }
  return m;
}

// List markers: "•" (by level •, ◦, ▪), "1." (counted per level; any other block at that level or
// above starts again), checkbox (null).
const BULLETS = ['•', '◦', '▪'];
export function listMarks(blocks) {
  const nums = [];
  return blocks.map(b => {
    const lv = b.listStyleType ? b.indent || 1 : 0;
    if (b.listStyleType === 'decimal') { nums.length = lv; nums[lv - 1] = (nums[lv - 1] || 0) + 1; return nums[lv - 1] + '.'; }
    nums.length = Math.max(0, lv - 1);
    return b.listStyleType === 'disc' ? BULLETS[(lv - 1) % 3] : null;
  });
}

// Word wrap like the editing view (white-space: pre-wrap; overflow-wrap: break-word): breaks at
// spaces and after hyphens, spaces stay at the end of a line, a word wider than the line is cut.
// → { blocks: [{ b, row0, rows, f, x0, mark, lines }], lines: [{ row, segs: [{ text, st, x, w }] }], rows }
export function layoutFlow(el, g) {
  const blocks = [], lines = [];
  const marks = listMarks(el.blocks || []);
  let row = 0;
  (el.blocks || []).forEach((b, bi) => {
    const f = blockFont(b, g), x0 = blockIndent(b, g), width = g.right - g.left - x0;
    const bl = { b, row0: row, f, x0, mark: marks[bi], lines: [] };
    let line;
    const newLine = () => { line = { row, segs: [], w: 0, f }; row += f.rows; bl.lines.push(line); lines.push(line); };
    newLine();
    const add = (text, st, w) => {
      const last = line.segs[line.segs.length - 1];
      if (last && last.st === st) { last.text += text; last.w += w; } else line.segs.push({ text, st, x: line.w, w });
      line.w += w;
    };
    for (const leaf of b.children || []) {
      if (!leaf.text) continue;
      const st = { ...leaf, size: f.size, bold: f.bold || !!leaf.bold };
      measure.font = fontOf(st);
      for (const tok of leaf.text.split(/(\n|[^\S\n]+)/)) {
        if (!tok) continue;
        if (tok === '\n') { newLine(); continue; }
        if (/^\s+$/.test(tok)) { add(tok, st, measure.measureText(tok).width); continue; }
        for (const part of tok.match(/[^-]*-+|[^-]+/g)) {
          let w = measure.measureText(part).width;
          const hasWord = line.segs.some(s => s.text.trim());
          if (hasWord && line.w + w > width) { newLine(); }
          if (w <= width - line.w) { add(part, st, w); continue; }
          // longer than a whole line: cut it into pieces that fit
          let rest = part;
          while (rest) {
            let n = rest.length;
            while (n > 1 && measure.measureText(rest.slice(0, n)).width > width - line.w) n--;
            const piece = rest.slice(0, n);
            w = measure.measureText(piece).width;
            add(piece, st, w);
            rest = rest.slice(n);
            if (rest) newLine();
          }
        }
      }
    }
    bl.rows = row - bl.row0;
    blocks.push(bl);
  });
  return { blocks, lines, rows: row };
}
// y of the ruling a layout row sits on, and of its baseline
export const rowLine = (g, row, f) => g.first + (row + f.rows - 1) * g.pitch;

export function flowText(el) {
  return (el.blocks || []).map(b => (b.children || []).map(c => c.text || '').join('')).join('\n');
}

export const flowColors = dark => ({
  text: dark ? '#F2F2F2' : '#1A1A1A', mute: dark ? '#9A9AA0' : '#8E8E93',
  quote: dark ? '#C7C7CC' : '#555555', bar: dark ? '#6E6E73' : '#C9C9C9', check: '#3E6E9F',
});

// Draws the flow of a page (page units; ctx already scaled).
export function drawFlow(ctx, el, page) {
  if (!el.blocks?.length) return;
  const g = lineGrid(page), L = layoutFlow(el, g), C = flowColors(page.paper === 'dark');
  ctx.save();
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  for (const bl of L.blocks) {
    const b = bl.b, done = b.listStyleType === 'todo' && !!b.checked, quote = b.type === 'blockquote';
    const x0 = g.left + bl.x0, base0 = rowLine(g, bl.row0, bl.f) - g.off;
    if (quote) {
      ctx.fillStyle = C.bar;
      const top = g.first + (bl.row0 - 1) * g.pitch + g.pitch * 0.22, bottom = g.first + (bl.row0 + bl.rows - 1) * g.pitch - g.pitch * 0.04;
      ctx.fillRect(g.left + 2, top, 3, bottom - top);
    }
    if (b.listStyleType) {
      const mx = x0 - g.istep;
      if (b.listStyleType === 'todo') {
        const s = r1(bl.f.size * 0.82), bx = mx + (g.istep - s) / 2, by = base0 - s * 0.86;
        ctx.beginPath(); ctx.roundRect(bx, by, s, s, s * 0.22);
        if (done) {
          ctx.fillStyle = C.check; ctx.fill();
          ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = s * 0.12; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath(); ctx.moveTo(bx + s * 0.25, by + s * 0.52); ctx.lineTo(bx + s * 0.43, by + s * 0.7); ctx.lineTo(bx + s * 0.76, by + s * 0.32); ctx.stroke();
        } else { ctx.strokeStyle = C.mute; ctx.lineWidth = Math.max(1, s * 0.09); ctx.stroke(); }
      } else {
        ctx.font = fontOf({ size: bl.f.size, bold: false });
        ctx.fillStyle = C.text;
        if (b.listStyleType === 'disc') { ctx.textAlign = 'center'; ctx.fillText(bl.mark, mx + g.istep / 2, base0); }
        else { ctx.textAlign = 'right'; ctx.fillText(bl.mark, x0 - g.istep * 0.2, base0); }
        ctx.textAlign = 'left';
      }
    }
    for (const line of bl.lines) {
      const base = rowLine(g, line.row, bl.f) - g.off;
      for (const s of line.segs) {
        const st = s.st, x = x0 + s.x, m = fontMetrics(st.size, st.bold);
        if (st.backgroundColor && st.backgroundColor !== 'transparent') {
          ctx.fillStyle = st.backgroundColor; ctx.fillRect(x, base - m.a, s.w, m.a + m.d);
        }
        const color = done ? C.mute : st.color || (quote ? C.quote : C.text);
        ctx.font = fontOf(st); ctx.fillStyle = color;
        ctx.fillText(s.text, x, base);
        const lw = Math.max(0.8, st.size * 0.06), w = s.text.trimEnd() === s.text ? s.w : s.w - measureEnd(s);
        if (st.underline) ctx.fillRect(x, base + st.size * 0.1, w, lw);
        if (st.strikethrough || done) ctx.fillRect(x, base - st.size * 0.3, w, lw);
      }
    }
  }
  ctx.restore();
}
// width of the trailing spaces of a segment (no lines under them)
function measureEnd(s) {
  measure.font = fontOf(s.st);
  return measure.measureText(s.text.slice(s.text.trimEnd().length)).width;
}

// For formats without typed text (.goodnotes export): one plain text box at the same place,
// lists as "• ", "1. ", "☐ "/"☑ " at the start of their lines; formats and line spacing are lost.
export function flowAsTextBox(el, page) {
  const g = lineGrid(page), marks = listMarks(el.blocks || []);
  const text = (el.blocks || []).map((b, i) => {
    const pre = b.listStyleType ? '   '.repeat((b.indent || 1) - 1) + (b.listStyleType === 'todo' ? (b.checked ? '☑ ' : '☐ ') : marks[i] + ' ') : '';
    return pre + (b.children || []).map(c => c.text || '').join('');
  }).join('\n');
  return { id: el.id, type: 'text', x: g.left, y: g.first - g.pitch, w: g.right - g.left, size: blockFont({ type: 'p' }, g).size, color: flowColors(page.paper === 'dark').text, text };
}
