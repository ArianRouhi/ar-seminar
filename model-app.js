// صفحه AR با شناسایی خودکار از روی مدل سه‌بعدی (Model Target) + ردیابی + افکت
// اگر شناسایی خودکار جواب نداد، کاربر می‌تواند روی هدست ضربه بزند.
import { ObjectTracker, toGray } from './tracker.js';

const NEON = '#44d62c';
const PROC_W = 192; // عرض تصویر پردازشی ردیاب
const DET_W = 160;  // عرض تصویر برای شناسایی
const DETECT_THRESHOLD = 0.72; // از تست: بیشینه صحنه بدون هدست ۰.۵۸، کمینه هدست ۰.۸۱
const worker = new Worker('./detect-worker.js', { type: 'module' });
const dcanvas = document.createElement('canvas');
const dctx = dcanvas.getContext('2d', { willReadFrequently: true });
let detBusy = false, workerReady = false, lostSince = 0;

const video = document.getElementById('video');
const fx = document.getElementById('fx');
const ctx = fx.getContext('2d');
const hint = document.getElementById('hint');
const proc = document.createElement('canvas');
const pctx = proc.getContext('2d', { willReadFrequently: true });

const tracker = new ObjectTracker();
let state = 'idle';        // idle | search | tracking
let drag = null;           // کادر در حال کشیدن (مختصات صفحه)
let screenBox = null;      // جعبه جسم روی صفحه (نرم‌شده)
let visible = 0;           // شفافیت افکت (برای ظاهر/محو شدن نرم)
let busy = false;
const notes = Array.from({ length: 7 }, (_, i) => ({ a: (i / 7) * Math.PI * 2, sp: 0.25 + Math.random() * 0.3, ph: Math.random(), ch: i % 2 ? '♪' : '♫' }));

function setHint(t) { hint.textContent = t; }

// تبدیل مختصات بین صفحه و تصویر ویدیو (با object-fit: cover)
function coverMap() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const sw = innerWidth, sh = innerHeight;
  const s = Math.max(sw / vw, sh / vh);
  return { s, ox: (sw - vw * s) / 2, oy: (sh - vh * s) / 2, k: PROC_W / vw };
}
function screenToProc(x, y) {
  const m = coverMap();
  return { x: ((x - m.ox) / m.s) * m.k, y: ((y - m.oy) / m.s) * m.k };
}
function procToScreen(b) {
  const m = coverMap();
  return { cx: (b.cx / m.k) * m.s + m.ox, cy: (b.cy / m.k) * m.s + m.oy, w: (b.w / m.k) * m.s, h: (b.h / m.k) * m.s };
}

function grabGray() {
  const w = PROC_W, h = Math.round(video.videoHeight * (PROC_W / video.videoWidth));
  if (proc.width !== w || proc.height !== h) { proc.width = w; proc.height = h; }
  pctx.drawImage(video, 0, 0, w, h);
  return { gray: toGray(pctx.getImageData(0, 0, w, h).data, w, h), w, h };
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  fx.width = innerWidth * dpr; fx.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize);

// ---------- انتخاب جسم با ضربه یا کشیدن کادر ----------
fx.addEventListener('pointerdown', (e) => {
  if (state === 'idle') return;
  drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
});
fx.addEventListener('pointermove', (e) => { if (drag) { drag.x1 = e.clientX; drag.y1 = e.clientY; } });
fx.addEventListener('pointerup', () => {
  if (!drag) return;
  let { x0, y0, x1, y1 } = drag;
  drag = null;
  let w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (w < 40 || h < 40) { // ضربه ساده: کادر پیش‌فرض
    w = h = Math.min(innerWidth, innerHeight) * 0.45;
  }
  const p = screenToProc(cx, cy);
  const k = screenToProc(cx + w / 2, cy + h / 2);
  const { gray, w: gw, h: gh } = grabGray();
  tracker.init(gray, gw, gh, { cx: p.x, cy: p.y, w: (k.x - p.x) * 2, h: (k.y - p.y) * 2 });
  screenBox = { cx, cy, w, h };
  state = 'tracking';
  setHint('در حال دنبال کردن هدست');
});

document.getElementById('resetBtn').addEventListener('click', () => {
  state = 'search'; screenBox = null; visible = 0;
  setHint('دوربین را روی هدست بگیرید تا خودکار شناسایی شود');
});

// ---------- حلقه اصلی ----------
function track() {
  if (state === 'tracking' && !busy && video.readyState >= 2) {
    busy = true;
    const { gray, w, h } = grabGray();
    const r = tracker.update(gray, w, h);
    if (r) {
      const b = procToScreen(r);
      const a = screenBox ? 0.5 : 1;
      screenBox = screenBox
        ? { cx: screenBox.cx + (b.cx - screenBox.cx) * a, cy: screenBox.cy + (b.cy - screenBox.cy) * a, w: screenBox.w + (b.w - screenBox.w) * a, h: screenBox.h + (b.h - screenBox.h) * a }
        : b;
      setHint('در حال دنبال کردن هدست');
      lostSince = 0;
    } else {
      if (!lostSince) lostSince = performance.now();
      setHint('هدست گم شد. دوربین را دوباره روی آن بگیرید');
      if (performance.now() - lostSince > 800) { state = 'search'; lostSince = 0; }
    }
    tracker.found = !!r;
    busy = false;
  }
}

// ---------- شناسایی خودکار ----------
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'ready') { workerReady = true; return; }
  if (m.type !== 'result') return;
  detBusy = false;
  const r = m.result;
  if (state !== 'search' || !r) return;
  if (r.score >= DETECT_THRESHOLD) {
    const k = PROC_W / DET_W;
    const { gray, w, h } = grabGray();
    tracker.init(gray, w, h, { cx: r.cx * k, cy: r.cy * k, w: r.w * k * 0.85, h: r.h * k * 0.85 });
    screenBox = procToScreen({ cx: r.cx * k, cy: r.cy * k, w: r.w * k, h: r.h * k });
    state = 'tracking';
    tracker.found = true;
    setHint('هدست خودکار شناسایی شد');
  }
};
worker.postMessage({ type: 'init', url: new URL('./templates.json', location.href).href });

function runDetection() {
  if (state !== 'search' || detBusy || !workerReady || video.readyState < 2) return;
  const w = DET_W, h = Math.round(video.videoHeight * (DET_W / video.videoWidth));
  if (dcanvas.width !== w || dcanvas.height !== h) { dcanvas.width = w; dcanvas.height = h; }
  dctx.drawImage(video, 0, 0, w, h);
  const rgba = dctx.getImageData(0, 0, w, h).data;
  detBusy = true;
  worker.postMessage({ type: 'detect', rgba, w, h }, [rgba.buffer]);
}

function drawEffect(t) {
  ctx.clearRect(0, 0, innerWidth, innerHeight);

  if (drag) { // کادر در حال کشیدن
    ctx.strokeStyle = NEON; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
    ctx.strokeRect(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
    ctx.setLineDash([]);
  }

  const target = state === 'tracking' && tracker.found ? 1 : 0;
  visible += (target - visible) * 0.15;
  if (!screenBox || visible < 0.02) return;

  const { cx, cy, w, h } = screenBox;
  const R = Math.max(w, h) / 2;
  ctx.save();
  ctx.globalAlpha = visible;

  // هاله
  const g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.3);
  g.addColorStop(0, 'rgba(68,214,44,0.28)'); g.addColorStop(1, 'rgba(68,214,44,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.3, 0, Math.PI * 2); ctx.fill();

  // گوشه‌های کادر
  const c = Math.min(w, h) * 0.18;
  ctx.strokeStyle = NEON; ctx.lineWidth = 3; ctx.shadowColor = NEON; ctx.shadowBlur = 12;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = cx + (sx * w) / 2, y = cy + (sy * h) / 2;
    ctx.beginPath(); ctx.moveTo(x - sx * c, y); ctx.lineTo(x, y); ctx.lineTo(x, y - sy * c); ctx.stroke();
  }

  // حلقه‌های موج صدا
  for (let i = 0; i < 3; i++) {
    const p = (t * 0.5 + i / 3) % 1;
    ctx.globalAlpha = visible * (1 - p) * 0.9;
    ctx.lineWidth = 3 * (1 - p) + 1;
    ctx.beginPath(); ctx.arc(cx, cy, R * (0.7 + p * 0.9), 0, Math.PI * 2); ctx.stroke();
  }

  // نت‌های موسیقی شناور
  ctx.shadowBlur = 8; ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const n of notes) {
    const p = (t * n.sp + n.ph) % 1;
    const ang = n.a + t * 0.5;
    const rad = R * (0.9 + p * 0.6);
    ctx.globalAlpha = visible * Math.sin(p * Math.PI);
    ctx.font = `${Math.round(R * 0.22 * (1 - p * 0.4))}px sans-serif`;
    ctx.fillText(n.ch, cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad - p * R * 0.3);
  }

  // برچسب
  ctx.globalAlpha = visible; ctx.shadowBlur = 0;
  ctx.font = 'bold 16px Tahoma, sans-serif';
  const label = 'هدست شناسایی شد';
  const tw = ctx.measureText(label).width + 24;
  // برچسب داخل صفحه بماند
  const lx = Math.min(innerWidth - tw / 2 - 8, Math.max(tw / 2 + 8, cx));
  const ly = Math.max(60, cy - h / 2 - 34);
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(lx - tw / 2, ly - 16, tw, 32, 10) : ctx.rect(lx - tw / 2, ly - 16, tw, 32); ctx.fill();
  ctx.fillStyle = NEON; ctx.fillText(label, lx, ly);
  ctx.restore();
}

function loop(now) {
  runDetection();
  track();
  drawEffect(now / 1000);
  requestAnimationFrame(loop);
}

// ---------- شروع ----------
async function start() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  });
  video.srcObject = stream;
  await video.play();
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('controls').style.display = 'flex';
  resize();
  state = 'search';
  setHint('دوربین را روی هدست بگیرید تا خودکار شناسایی شود');
  requestAnimationFrame(loop);
}

document.getElementById('startBtn').addEventListener('click', () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    document.getElementById('browserWarning').style.display = 'block';
    return;
  }
  start().catch((err) => { setHint('خطا در باز کردن دوربین: ' + err.message); document.getElementById('startScreen').style.display = 'none'; });
});
