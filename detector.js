// شناسایی جسم از روی مدل سه‌بعدی (Model Target ساده)
// روش: تطبیق جهت لبه‌ها (شبیه LINEMOD). برای جسم‌های تیره و بی‌طرح مناسب است،
// چون به شکل و لبه‌ها نگاه می‌کند، نه به طرح روی سطح. به پس‌زمینه هم وابسته نیست،
// چون نماها از مدل بدون پس‌زمینه ساخته شده‌اند.

export const NBINS = 8; // جهت لبه در ۸ دسته (۰ تا ۱۸۰ درجه)

// جدول شباهت بین دو جهت: ۴ = یکسان، ۰ = عمود
const LUT = (() => {
  const t = new Uint8Array(NBINS * 256);
  for (let o = 0; o < NBINS; o++) {
    for (let m = 0; m < 256; m++) {
      let best = 0;
      for (let b = 0; b < NBINS; b++) {
        if (!(m & (1 << b))) continue;
        const diff = Math.min(Math.abs(o - b), NBINS - Math.abs(o - b));
        best = Math.max(best, diff === 0 ? 4 : diff === 1 ? 1 : 0);
      }
      // جریمه نواحی شلوغ: اگر در یک نقطه جهت‌های زیادی هست، ارزش تطبیق کمتر است
      let bits = 0;
      for (let b = 0; b < NBINS; b++) if (m & (1 << b)) bits++;
      t[o * 256 + m] = bits <= 2 ? best : Math.round(best * 2 / bits);
    }
  }
  return t;
})();

// گرادیان و دسته‌بندی جهت لبه برای هر پیکسل (255 = لبه ضعیف)
export function gradientBins(gray, w, h, magThr) {
  const bins = new Uint8Array(w * h).fill(255);
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1] - gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1];
      const gy = gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1] - gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1];
      const m = gx * gx + gy * gy;
      mag[i] = m;
      if (m < magThr * magThr) continue;
      let a = Math.atan2(gy, gx);
      if (a < 0) a += Math.PI;
      bins[i] = Math.min(NBINS - 1, Math.floor((a / Math.PI) * NBINS));
    }
  }
  return { bins, mag };
}

// پخش کردن جهت‌ها در همسایگی، برای تحمل جابه‌جایی کوچک
function spread(bins, w, h, r) {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const b = bins[y * w + xx];
        if (b !== 255) m |= 1 << b;
      }
      tmp[y * w + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        m |= tmp[yy * w + x];
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

// نقشه پاسخ برای هر جهت: سرعت تطبیق را خیلی بالا می‌برد
export const MAG_THR = 110;
export function responseMaps(gray, w, h, magThr = MAG_THR, r = 1) {
  const { bins } = gradientBins(gray, w, h, magThr);
  const sp = spread(bins, w, h, r);
  const maps = [];
  for (let o = 0; o < NBINS; o++) {
    const m = new Uint8Array(w * h);
    const base = o * 256;
    for (let i = 0; i < m.length; i++) m[i] = LUT[base + sp[i]];
    maps.push(m);
  }
  return maps;
}

// پیکسل‌های سبز نئون (کابل و اتصالات هدست) — نشانه دوم برای جدا کردن هدست از پس‌زمینه
export function isNeonGreen(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx < 70 || g !== mx) return false;
  const sat = (mx - mn) / mx;
  return sat > 0.4 && g > r * 1.25 && g > b * 1.15;
}
export function greenMask(rgba, w, h, r = 2) {
  const m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) if (isNeonGreen(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2])) m[i] = 1;
  if (!r) return m;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!m[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) out[yy * w + xx] = 1;
    }
  }
  return out;
}
function greenScore(gmask, w, h, pts, cx, cy, s) {
  if (!gmask || !pts || !pts.length) return null;
  let hit = 0;
  for (const p of pts) {
    const x = Math.round(cx + p[0] * s), y = Math.round(cy + p[1] * s);
    if (x >= 0 && y >= 0 && x < w && y < h && gmask[y * w + x]) hit++;
  }
  return hit / pts.length;
}

// امتیاز یک قالب در یک موقعیت و اندازه (۰ تا ۱)
function scoreAt(maps, w, h, feats, cx, cy, s) {
  let sum = 0;
  for (let k = 0; k < feats.length; k++) {
    const f = feats[k];
    const x = Math.round(cx + f[0] * s), y = Math.round(cy + f[1] * s);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    sum += maps[f[2]][y * w + x];
  }
  return sum / (4 * feats.length);
}

// امتیاز ترکیبی: لبه‌ها + رنگ سبز (اگر قالب نقطه سبز دارد)
function combined(maps, gm, w, h, tpl, cx, cy, s) {
  const e = scoreAt(maps, w, h, tpl.f, cx, cy, s);
  const g = greenScore(gm, w, h, tpl.g, cx, cy, s);
  return { e, g, total: g === null ? e : e + 0.4 * g - (g === 0 ? 0.1 : 0) };
}

// جستجوی کامل: همه نماها، چند اندازه، همه موقعیت‌ها. بعد دقیق‌تر کردن بهترین نتیجه‌ها.
export function detect(maps, w, h, templates, opts = {}) {
  const scales = opts.scales || [0.7, 1, 1.4, 2, 2.8];
  const step = opts.step || 3;
  const gm = opts.green || null;
  const results = [];
  for (let t = 0; t < templates.length; t++) {
    const tpl = templates[t];
    for (const s of scales) {
      const hw = (tpl.w * s) / 2, hh = (tpl.h * s) / 2;
      if (hw * 2 > w * 1.05 || hh * 2 > h * 1.05) continue;
      let best = { total: -1 };
      for (let cy = hh * 0.5; cy < h - hh * 0.5; cy += step) {
        for (let cx = hw * 0.5; cx < w - hw * 0.5; cx += step) {
          const c = combined(maps, gm, w, h, tpl, cx, cy, s);
          if (c.total > best.total) best = { ...c, cx, cy };
        }
      }
      results.push({ t, s, ...best });
    }
  }
  results.sort((a, b) => b.total - a.total);
  let top = null;
  for (const r of results.slice(0, opts.topK || 8)) {
    const tpl = templates[r.t];
    let b = r;
    for (const ds of [0.9, 1, 1.1]) {
      const s = r.s * ds;
      for (let dy = -step; dy <= step; dy++) {
        for (let dx = -step; dx <= step; dx++) {
          const c = combined(maps, gm, w, h, tpl, r.cx + dx, r.cy + dy, s);
          if (c.total > b.total) b = { t: r.t, s, ...c, cx: r.cx + dx, cy: r.cy + dy };
        }
      }
    }
    if (!top || b.total > top.total) top = b;
  }
  if (!top) return null;
  const tpl = templates[top.t];
  return { score: top.total, edge: top.e, green: top.g, cx: top.cx, cy: top.cy, w: tpl.w * top.s, h: tpl.h * top.s, view: tpl.view };
}
