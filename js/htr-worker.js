// Handwriting recognition (beta) — the model, in a worker so writing never waits for it.
// DE·HTR v2 (naeyn/de-htr-web-v2, Apache-2.0): German handwriting, one line image per call,
// ONNX Runtime Web on WebAssembly, single-threaded (GitHub Pages sends no cross-origin isolation).
// Messages: { line: id, data: Float32Array, width } → { line: id, text } | { error }.
// The model file is kept in IndexedDB ('folio-htr'), so it is downloaded once and works offline.
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/'; // ≥ 1.2x: the int8 model needs ConvInteger
const REV = '6241c1ff0fd42725e0dc46fcd3217469cac851bb'; // pinned model revision
const BASE = `https://huggingface.co/naeyn/de-htr-web-v2/resolve/${REV}/`;

const db = new Promise((res, rej) => {
  const r = indexedDB.open('folio-htr', 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('files'); r.result.createObjectStore('pages'); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const idb = async (mode, fn) => { const d = await db; return new Promise((res, rej) => { const t = d.transaction('files', mode), q = fn(t.objectStore('files')); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); };
async function file(name, as) {
  const key = REV + '/' + name;
  let v = await idb('readonly', s => s.get(key));
  if (!v) {
    const r = await fetch(BASE + name);
    if (!r.ok) throw new Error(`${name}: ${r.status}`);
    v = as === 'json' ? await r.json() : await r.arrayBuffer();
    await idb('readwrite', s => s.put(v, key));
  }
  return v;
}

let ready = null;
function load() {
  return ready ||= (async () => {
    const ort = await import(ORT + 'ort.wasm.min.mjs');
    ort.env.wasm.wasmPaths = ORT; ort.env.wasm.numThreads = 1;
    const [cfg, model] = await Promise.all([file('config.json', 'json'), file('model.onnx')]);
    const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return { ort, cfg, session };
  })().catch(e => { ready = null; throw e; });
}

self.onmessage = async ({ data: m }) => {
  try {
    const { ort, cfg, session } = await load();
    if (m.warm) return self.postMessage({ warm: true, height: cfg.image_height, maxWidth: cfg.max_width, stride: cfg.output_stride });
    const H = cfg.image_height;
    const out = await session.run({ [cfg.input_name]: new ort.Tensor('float32', m.data, [1, 1, H, m.width]) });
    const lg = out[cfg.output_name], [, T, C] = lg.dims, blank = cfg.blank_index;
    // greedy CTC: best class per step, repeats and blanks dropped
    let text = '', prev = -1;
    for (let t = 0; t < T; t++) {
      let best = 0, bv = -Infinity;
      for (let c = 0; c < C; c++) { const v = lg.data[t * C + c]; if (v > bv) { bv = v; best = c; } }
      if (best !== prev && best !== blank) text += cfg.alphabet[best - 1];
      prev = best;
    }
    self.postMessage({ line: m.line, text });
  } catch (e) {
    self.postMessage({ line: m.line, error: String(e?.message || e) });
  }
};
