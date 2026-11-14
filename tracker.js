// ردیاب جسم بدون هوش مصنوعی و بدون سرور
// روش: Template Matching با Normalized Cross-Correlation روی تصویر خاکستری کوچک‌شده
// کاربر یک بار جسم را انتخاب می‌کند، بعد هر فریم نزدیک‌ترین ناحیه مشابه پیدا می‌شود.

export const T = 32; // اندازه قالب (۳۲×۳۲ پیکسل)

// تبدیل RGBA به خاکستری + کمی تار کردن برای کاهش نویز
export function toGray(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          s += g[yy * w + xx]; n++;
        }
      }
      out[y * w + x] = s / n;
    }
  }
  return out;
}

// برداشتن یک ناحیه (cx, cy, bw, bh) و نمونه‌برداری به اندازه T×T، نرمال‌شده
export function samplePatch(gray, w, h, cx, cy, bw, bh, out) {
  const x0 = cx - bw / 2, y0 = cy - bh / 2;
  const sx = bw / T, sy = bh / T;
  let sum = 0;
  for (let j = 0; j < T; j++) {
    const yy = Math.min(h - 1, Math.max(0, Math.round(y0 + (j + 0.5) * sy)));
    for (let i = 0; i < T; i++) {
      const xx = Math.min(w - 1, Math.max(0, Math.round(x0 + (i + 0.5) * sx)));
      const v = gray[yy * w + xx];
      out[j * T + i] = v;
      sum += v;
    }
  }
  const mean = sum / (T * T);
  let ss = 0;
  for (let k = 0; k < T * T; k++) { out[k] -= mean; ss += out[k] * out[k]; }
  const norm = Math.sqrt(ss) || 1;
  for (let k = 0; k < T * T; k++) out[k] /= norm;
  return out;
}

function dot(a, b) {
  let s = 0;
  for (let k = 0; k < a.length; k++) s += a[k] * b[k];
  return s;
}

export class ObjectTracker {
  constructor() {
    this.box = null;        // {cx, cy, w, h} در مختصات تصویر کوچک
    this.original = null;   // قالب اولیه (ثابت، برای جلوگیری از لغزش)
    this.adaptive = null;   // قالب به‌روزشونده
    this.score = 0;
    this.lost = true;
    this.buf = new Float32Array(T * T);
  }

  init(gray, w, h, box) {
    this.box = { ...box };
    this.baseSize = { w: box.w, h: box.h }; // اندازه اولیه، برای جستجوی دوباره
    this.original = samplePatch(gray, w, h, box.cx, box.cy, box.w, box.h, new Float32Array(T * T));
    this.adaptive = this.original.slice();
    this.lost = false;
    this.score = 1;
  }

  _match(gray, w, h, cx, cy, bw, bh) {
    const p = samplePatch(gray, w, h, cx, cy, bw, bh, this.buf);
    return Math.max(dot(p, this.original), 0.9 * dot(p, this.adaptive));
  }

  _search(gray, w, h, cx0, cy0, radius, step, scales, size = this.box) {
    let best = { score: -1 };
    for (const s of scales) {
      const bw = size.w * s, bh = size.h * s;
      if (bw < 12 || bh < 12 || bw > w * 1.2 || bh > h * 1.2) continue;
      for (let dy = -radius; dy <= radius; dy += step) {
        for (let dx = -radius; dx <= radius; dx += step) {
          const cx = cx0 + dx, cy = cy0 + dy;
          const sc = this._match(gray, w, h, cx, cy, bw, bh);
          if (sc > best.score) best = { score: sc, cx, cy, w: bw, h: bh };
        }
      }
    }
    return best;
  }

  update(gray, w, h) {
    if (!this.box) return null;
    let best;
    if (!this.lost) {
      // جستجوی محلی دور موقعیت قبلی: درشت، بعد ریز
      const coarse = this._search(gray, w, h, this.box.cx, this.box.cy, 16, 2, [0.93, 1, 1.07]);
      this.box.w = coarse.w || this.box.w; this.box.h = coarse.h || this.box.h;
      best = this._search(gray, w, h, coarse.cx, coarse.cy, 2, 1, [1]);
    } else {
      // جسم گم شده: جستجوی کل تصویر با گام بزرگ و چند اندازه
      const r = Math.max(w, h);
      // اندازه جعبه را تغییر نمی‌دهیم تا جسم پیدا شود (جلوگیری از به‌هم‌ریختگی)
      const coarse = this._search(gray, w, h, w / 2, h / 2, r / 2, 6, [0.75, 1, 1.3], this.baseSize);
      best = coarse.score > 0
        ? this._search(gray, w, h, coarse.cx, coarse.cy, 6, 2, [0.93, 1, 1.07], coarse)
        : coarse;
      if (best.score < 0.68) return (this.score = best.score), null;
      this.box.w = best.w; this.box.h = best.h;
      this.box.cx = best.cx; this.box.cy = best.cy;
    }

    this.score = best.score;
    const LOSE = 0.55, FIND = 0.68;
    if (this.lost) {
      if (best.score >= FIND) this.lost = false; else return null;
    } else if (best.score < LOSE) {
      this.lost = true;
      return null;
    }

    // نرم کردن حرکت
    const a = 0.6;
    this.box.cx = this.box.cx * (1 - a) + best.cx * a;
    this.box.cy = this.box.cy * (1 - a) + best.cy * a;
    this.box.w = this.box.w * (1 - a) + best.w * a;
    this.box.h = this.box.h * (1 - a) + best.h * a;

    // به‌روزرسانی آرام قالب وقتی مطمئن هستیم
    if (best.score > 0.8) {
      const p = samplePatch(gray, w, h, this.box.cx, this.box.cy, this.box.w, this.box.h, this.buf);
      let ss = 0;
      for (let k = 0; k < T * T; k++) { this.adaptive[k] = 0.9 * this.adaptive[k] + 0.1 * p[k]; ss += this.adaptive[k] ** 2; }
      const n = Math.sqrt(ss) || 1;
      for (let k = 0; k < T * T; k++) this.adaptive[k] /= n;
    }
    return { ...this.box, score: best.score };
  }
}
