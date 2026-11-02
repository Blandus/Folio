import { h, clamp } from './util.js';
import { icon } from './icons.js';

// ---------- Toast ----------
// action: { label, run } adds a button (e.g. "Rückgängig"); a newer toast replaces it.
let toastT;
export function toast(msg, ms = 2400, action = null) {
  let t = document.getElementById('toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status' }); document.body.append(t); }
  const hide = () => t.classList.remove('show');
  t.replaceChildren(h('span', {}, msg), action ? h('button', { class: 'toast-action', onclick: () => { hide(); action.run(); } }, action.label) : '');
  t.classList.toggle('has-action', !!action);
  t.classList.add('show');
  clearTimeout(toastT);
  if (ms) toastT = setTimeout(hide, ms);
}

// ---------- Popovers & menus ----------
let current = null;
export function closePopover() { current?.close(); }

// anchor: Element or {x, y}
export function popover(anchor, content, { className = '' } = {}) {
  closePopover();
  const pop = h('div', { class: 'popover ' + className }, content);
  document.body.append(pop);
  const place = () => {
    const a = anchor instanceof Element ? anchor.getBoundingClientRect()
      : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0 };
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
    pop.style.maxHeight = Math.max(0, height - 16) + 'px';
    pop.style.maxWidth = Math.max(0, width - 16) + 'px';
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    const x = clamp(a.left + a.width / 2 - pw / 2, left + 8, Math.max(left + 8, left + width - pw - 8));
    let y = a.bottom + 8;
    const above = y + ph > top + height - 8;
    if (above) y = a.top - ph - 8;
    y = clamp(y, top + 8, Math.max(top + 8, top + height - ph - 8));
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
    pop.style.transformOrigin = `${a.left + a.width / 2 - x}px ${above ? ph : 0}px`;
  };
  place();
  window.addEventListener('resize', place);
  window.visualViewport?.addEventListener('resize', place);
  window.visualViewport?.addEventListener('scroll', place);
  const onDown = e => {
    if (pop.contains(e.target)) return;
    if (anchor instanceof Element && anchor.contains(e.target)) return; // anchor click toggles
    close();
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  setTimeout(() => { document.addEventListener('pointerdown', onDown, true); document.addEventListener('keydown', onKey); });
  function close() {
    window.removeEventListener('resize', place);
    window.visualViewport?.removeEventListener('resize', place);
    window.visualViewport?.removeEventListener('scroll', place);
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey);
    // short fade towards the trigger (same origin it grew from); gone for input at once
    pop.classList.add('closing');
    setTimeout(() => pop.remove(), 110);
    if (current === api) current = null;
  }
  const api = { close, el: pop, place, anchor };
  current = api;
  return api;
}

// items: [{label, icon, action, danger, checked, disabled}] or '-'
export function menu(anchor, items, opts) {
  if (current && current.anchor === anchor) return closePopover();
  let p;
  const list = h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean).map(it => it === '-'
    ? h('div', { class: 'menu-sep' })
    : h('button', {
      class: 'menu-item' + (it.danger ? ' danger' : ''), role: 'menuitem', disabled: it.disabled,
      onclick: () => { p.close(); it.action(); },
    },
      h('span', { class: 'menu-label' }, it.label),
      it.checked !== undefined ? h('span', { class: 'menu-icon' }, it.checked ? icon('check', 18) : '')
        : it.swatch ? h('span', { class: 'menu-swatch', style: { background: it.swatch } })
          : it.icon ? h('span', { class: 'menu-icon' }, icon(it.icon, 18)) : '')));
  p = popover(anchor, list, opts);
  return p;
}

// ---------- Sheets (iOS-style modal with Cancel / Title / Done) ----------
export function sheet({ title, body, done = 'Fertig', onDone, cancel = true, className = '' }) {
  return new Promise(resolve => {
    const back = h('div', { class: 'backdrop' });
    const finish = v => {
      document.removeEventListener('keydown', onKey);
      back.classList.add('closing');
      setTimeout(() => back.remove(), 200);
      resolve(v);
    };
    const submit = async () => { const v = onDone ? await onDone() : true; if (v !== false) finish(v); };
    const onKey = e => {
      if (e.key === 'Escape') { if (document.querySelector('.popover:not(.closing)')) return; finish(null); } // Esc closes an open menu first
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); submit(); }
    };
    document.addEventListener('keydown', onKey);
    const box = h('div', { class: 'sheet ' + className, role: 'dialog', 'aria-label': title },
      h('div', { class: 'sheet-head' },
        cancel ? h('button', { class: 'textbtn', onclick: () => finish(null) }, 'Abbrechen') : h('span'),
        h('div', { class: 'sheet-title' }, title),
        done ? h('button', { class: 'textbtn strong', onclick: submit }, done) : h('span')),
      h('div', { class: 'sheet-body' }, body));
    back.append(box);
    back.addEventListener('pointerdown', e => { if (e.target === back) finish(null); });
    document.body.append(back);
    swipeToDismiss(box, () => finish(null));
    box.querySelector('input:not([type=color]):not([type=checkbox])')?.focus();
  });
}

// ---------- Swipe down to dismiss (dialogs) ----------
// Dragging a dialog by its top area moves it 1:1 with the finger (resisting upwards). On release
// the motion is projected from the release velocity: far or fast enough down → it leaves
// downwards at that speed, otherwise it springs back. Grabbing it again mid-motion takes over.
const project = (v, d = 0.99) => (v / 1000) * d / (1 - d); // where a flick would come to rest
const rubber = (x, dim, c = 0.55) => (x * dim * c) / (dim + c * Math.abs(x));
// critically damped spring from `from` to `to`, starting at velocity v (px/s); returns stop()
function spring(from, to, v, set, done, response = 0.35) {
  const w = 2 * Math.PI / response;
  let x = from - to, raf, last = performance.now();
  const step = now => {
    const dt = Math.min(0.032, (now - last) / 1000); last = now;
    v += (-w * w * x - 2 * w * v) * dt; x += v * dt;
    if (Math.abs(x) < 0.5 && Math.abs(v) < 20) { set(to); done?.(); return; }
    set(to + x); raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}
export function swipeToDismiss(box, onDismiss, { grip = 56 } = {}) {
  const back = box.parentElement;
  let y = 0, stop = null;
  const set = v => { y = v; box.style.transform = v ? `translateY(${v}px)` : ''; if (back) back.style.opacity = v > 0 ? String(1 - Math.min(0.6, v / (box.offsetHeight * 1.5))) : ''; };
  box.addEventListener('pointerdown', e => {
    if (e.button > 0 || e.target.closest('button, input, textarea, select, a, [contenteditable="true"], .stepper')) return;
    if (e.clientY - box.getBoundingClientRect().top + y > grip) return; // only the top area is a handle
    stop?.(); stop = null;
    const start = e.clientY - Math.max(0, y), hist = [];
    let dragging = false;
    const move = ev => {
      const dy = ev.clientY - start;
      if (!dragging && Math.abs(dy) < 6) return;
      if (!dragging) { dragging = true; try { box.setPointerCapture(e.pointerId); } catch {} box.style.animation = 'none'; }
      hist.push([ev.timeStamp, ev.clientY]); if (hist.length > 6) hist.shift();
      set(dy >= 0 ? dy : rubber(dy, box.offsetHeight));
    };
    const up = ev => {
      box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', up); box.removeEventListener('pointercancel', up);
      if (!dragging) return;
      const [t0, y0] = hist[0] || [0, 0], [t1, y1] = hist[hist.length - 1] || [0, 0];
      // velocity of the last moves; none if the finger rested before lifting
      const v = t1 > t0 && ev.timeStamp - t1 < 80 ? (y1 - y0) / (t1 - t0) * 1000 : 0;
      const h = box.offsetHeight;
      if (y + project(v) > Math.max(120, h * 0.4) && v > -100) {
        box.classList.add('swiped');
        stop = spring(y, h + 80, Math.max(v, 600), set, null, 0.3);
        onDismiss();
      } else stop = spring(y, 0, v, set, () => { stop = null; });
    };
    box.addEventListener('pointermove', move); box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  });
}

// suggestions: tappable chips under the field that fill it in
export async function promptText(title, value = '', placeholder = '', suggestions = []) {
  const input = h('input', { class: 'field', value, placeholder });
  setTimeout(() => input.select());
  const sugg = suggestions.filter(s => s !== value);
  const body = sugg.length ? h('div', { class: 'form' }, input,
    h('div', { class: 'suggest-label' }, 'Vorschläge'),
    h('div', { class: 'suggest-chips' }, sugg.map(s => h('button', {
      class: 'suggest-chip', onclick: () => { input.value = s; input.focus(); input.select(); },
    }, s)))) : input;
  const v = await sheet({ title, body, onDone: () => input.value.trim() || false });
  return v || null;
}

// Small centred alert with two buttons.
export function confirmBox(title, message, okLabel = 'OK', danger = false) {
  return new Promise(resolve => {
    const back = h('div', { class: 'backdrop' });
    const finish = v => { back.classList.add('closing'); setTimeout(() => back.remove(), 200); resolve(v); };
    back.append(h('div', { class: 'alert', role: 'alertdialog' },
      h('div', { class: 'alert-title' }, title),
      message && h('div', { class: 'alert-msg' }, message),
      h('div', { class: 'alert-btns' },
        h('button', { onclick: () => finish(false) }, 'Abbrechen'),
        h('button', { class: danger ? 'danger strong' : 'strong', onclick: () => finish(true) }, okLabel))));
    document.body.append(back);
  });
}

// Segmented control
export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'segmented' });
  const render = v => {
    wrap.replaceChildren(...options.map(([val, label]) => h('button', {
      class: val === v ? 'active' : '', onclick: () => { render(val); onChange(val); },
    }, label)));
  };
  render(value);
  return wrap;
}

export function toggle(label, checked, onChange) {
  const input = h('input', { type: 'checkbox', class: 'switch' });
  input.checked = !!checked;
  input.onchange = () => onChange(input.checked);
  return h('label', { class: 'toggle-row' }, h('span', {}, label), input);
}
