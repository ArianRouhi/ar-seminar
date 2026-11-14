// شناسایی در پس‌زمینه (Web Worker) تا صفحه کند نشود
import { responseMaps, detect, greenMask } from './detector.js';

let templates = null;

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    templates = await (await fetch(msg.url)).json();
    self.postMessage({ type: 'ready', count: templates.length });
    return;
  }
  if (msg.type === 'detect' && templates) {
    const { rgba, w, h } = msg;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    const t0 = performance.now();
    const r = detect(responseMaps(gray, w, h), w, h, templates, { green: greenMask(rgba, w, h) });
    self.postMessage({ type: 'result', result: r, ms: performance.now() - t0, id: msg.id });
  }
};
