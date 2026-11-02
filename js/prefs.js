// The tool row is the same on every device: pens, colours, widths, which colour and width is
// chosen, favourites, own colours and the palette. They live in one record
//   { kind: 'prefs', id: 'prefs-tools', tools, customColors, palette, updated }
// that the Drive sync carries like a document (the newer one wins, see sync.js / merge.js).
// Device matters stay per device: pencil pressure calibration, finger drawing, panel layout.
// The record is written only when the tool row changes, so a newly installed device takes over
// the tool row of the others instead of overwriting it.
import { store, settings, saveSettings, bus, onSettingsSaved } from './store.js';

export const PREFS_ID = 'prefs-tools';
const snap = () => JSON.stringify({ tools: settings.tools || {}, customColors: settings.customColors || [], palette: settings.palette || 'standard' });

// editor.js puts a received tool row into place: hooks.apply(prefs)
let hooks = { apply: null };
// (called once the tool row is set up)
export function configurePrefs(h) {
  hooks = { ...hooks, ...h };
  if (settings.prefsSynced === undefined) { settings.prefsSynced = snap(); applying = true; saveSettings(); applying = false; } // first start with v78: nothing to send yet
}

let applying = false, timer = null;

onSettingsSaved(() => {
  if (applying) return;
  clearTimeout(timer);
  timer = setTimeout(write, 800);
});
async function write() {
  const s = snap();
  if (s === settings.prefsSynced) return;
  settings.prefsSynced = s;
  applying = true; saveSettings(); applying = false;
  await store.put({ kind: 'prefs', id: PREFS_ID, name: 'Werkzeugleiste', ...JSON.parse(s), updated: Date.now() });
}

// A newer tool row came from another device
async function apply() {
  const r = await store.get(PREFS_ID);
  if (!r || r.deleted || !r.tools || !hooks.apply) return;
  const s = JSON.stringify({ tools: r.tools, customColors: r.customColors || [], palette: r.palette || 'standard' });
  if (s === snap()) return;
  applying = true;
  try { hooks.apply(r); } finally {
    settings.prefsSynced = snap();
    saveSettings();
    applying = false;
  }
}
bus.addEventListener('remote', e => { if (e.detail === PREFS_ID) apply(); });
