/**
 * Turns any 2D raster (photo, logo, rasterised map) into a point cloud:
 * pixels are picked with probability proportional to their weight, so dense
 * or bright regions get more particles.
 */

export interface Raster {
  width: number;
  height: number;
  /** Relative chance of a particle landing on each pixel (0 = never). */
  weight: Float32Array;
  /** Brightness 0..1 per pixel; drives particle opacity. */
  luma: Float32Array;
  /** Height toward the camera 0..1 per pixel. */
  depth: Float32Array;
}

export interface PointCloud {
  count: number;
  /** xyz triples. Height-normalised: y spans -0.5..0.5, x is ±aspect/2. */
  positions: Float32Array;
  luma: Float32Array;
  /** Optional per-point label that must travel with the point (e.g. card index). */
  tag?: Float32Array;
}

export function sampleRaster(raster: Raster, count: number, depthScale: number): PointCloud {
  return pointsAt(raster, weightedPixels(raster.weight, count), depthScale);
}

/** `count` pixel indices drawn independently, in proportion to weight. */
function weightedPixels(weight: Float32Array, count: number): number[] {
  const cdf = new Float64Array(weight.length);
  let total = 0;
  for (let i = 0; i < weight.length; i++) {
    total += weight[i];
    cdf[i] = total;
  }
  const picked: number[] = [];
  for (let k = 0; k < count; k++) {
    const target = Math.random() * total;
    let lo = 0;
    let hi = weight.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cdf[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    picked.push(lo);
  }
  return picked;
}

/** One point per picked pixel, jittered within it. */
function pointsAt(raster: Raster, picked: number[], depthScale: number): PointCloud {
  const { width: w, height: h, luma: pixelLuma, depth } = raster;
  const count = picked.length;
  const positions = new Float32Array(count * 3);
  const luma = new Float32Array(count);
  for (let k = 0; k < count; k++) {
    const i = picked[k];
    const x = (i % w) + Math.random();
    const y = Math.floor(i / w) + Math.random();
    positions[k * 3] = (x - w / 2) / h;
    positions[k * 3 + 1] = (h / 2 - y) / h;
    positions[k * 3 + 2] = (depth[i] - 0.5) * depthScale + (Math.random() - 0.5) * 0.008;
    luma[k] = pixelLuma[i];
  }
  return { count, positions, luma };
}

/**
 * Like sampleRaster, but places dots by error-diffusion dithering instead of
 * independent random picks: dots spread evenly in proportion to weight, so
 * fine detail (eyes, brows, a smile) stays crisp instead of dissolving into
 * noise. Used for portraits.
 */
export function ditherRaster(raster: Raster, count: number, depthScale: number): PointCloud {
  const { width: w, height: h, weight } = raster;
  let total = 0;
  for (let i = 0; i < weight.length; i++) total += weight[i];
  const scale = count / (total || 1);

  // Serpentine Floyd–Steinberg on "expected dots per pixel".
  const value = new Float32Array(weight.length);
  for (let i = 0; i < value.length; i++) value[i] = weight[i] * scale;
  const picked: number[] = [];
  for (let y = 0; y < h; y++) {
    const ltr = y % 2 === 0;
    for (let k = 0; k < w; k++) {
      const x = ltr ? k : w - 1 - k;
      const i = y * w + x;
      const dots = Math.max(0, Math.round(value[i]));
      for (let d = 0; d < dots; d++) picked.push(i);
      const err = value[i] - dots;
      const dir = ltr ? 1 : -1;
      if (x + dir >= 0 && x + dir < w) value[i + dir] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x - dir >= 0 && x - dir < w) value[i + w - dir] += (err * 3) / 16;
        value[i + w] += (err * 5) / 16;
        if (x + dir >= 0 && x + dir < w) value[i + w + dir] += err / 16;
      }
    }
  }

  // Diffusion lands within a fraction of a percent of `count`; even it out.
  while (picked.length > count) {
    const k = Math.floor(Math.random() * picked.length);
    picked[k] = picked[picked.length - 1];
    picked.pop();
  }
  if (picked.length < count) picked.push(...weightedPixels(weight, count - picked.length));
  return pointsAt(raster, picked, depthScale);
}

/**
 * Sorts a cloud top-to-bottom so particle i in one shape lands roughly where
 * particle i sits in the next — morphs then flow instead of scrambling.
 */
export function sortByHeight(cloud: PointCloud): PointCloud {
  const order = Array.from({ length: cloud.count }, (_, i) => i);
  const jittered = order.map((i) => cloud.positions[i * 3 + 1] + (Math.random() - 0.5) * 0.04);
  order.sort((a, b) => jittered[b] - jittered[a]);
  const positions = new Float32Array(cloud.count * 3);
  const luma = new Float32Array(cloud.count);
  const tag = cloud.tag ? new Float32Array(cloud.count) : undefined;
  order.forEach((from, to) => {
    positions[to * 3] = cloud.positions[from * 3];
    positions[to * 3 + 1] = cloud.positions[from * 3 + 1];
    positions[to * 3 + 2] = cloud.positions[from * 3 + 2];
    luma[to] = cloud.luma[from];
    if (tag && cloud.tag) tag[to] = cloud.tag[from];
  });
  return { count: cloud.count, positions, luma, tag };
}

/** A raster straight from a canvas's alpha: opaque = dense, bright dots. */
export function rasterFromAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): Raster {
  const { data } = ctx.getImageData(0, 0, w, h);
  const weight = new Float32Array(w * h);
  const luma = new Float32Array(w * h);
  for (let i = 0; i < weight.length; i++) {
    const a = data[i * 4 + 3] / 255;
    weight[i] = a;
    luma[i] = 0.3 + 0.7 * a;
  }
  return { width: w, height: h, weight, luma, depth: new Float32Array(w * h) };
}

/**
 * Chamfer distance from every inside pixel to the nearest outside pixel, in
 * pixels. `openBottom` treats the bottom edge as inside, for subjects that
 * are cropped there (a bust shouldn't round off at the frame edge).
 */
export function distanceField(mask: Uint8Array, w: number, h: number, openBottom = false): Float32Array {
  const far = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? far : 0;
  const at = (x: number, y: number): number => {
    if (x < 0 || x >= w || y < 0) return 0;
    if (y >= h) return openBottom ? far : 0;
    return d[y * w + x];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  }
  for (let i = 0; i < d.length; i++) d[i] = d[i] >= far ? 0 : d[i] / 3;
  return d;
}

/** Separable box blur, repeated `passes` times (3 passes ≈ gaussian). */
export function blur(src: Float32Array, w: number, h: number, radius: number, passes = 3): Float32Array {
  const a = src.slice();
  const b = new Float32Array(src.length);
  const r = Math.max(1, Math.round(radius));
  const norm = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[y * w + Math.min(Math.max(x, 0), w - 1)];
      for (let x = 0; x < w; x++) {
        b[y * w + x] = acc * norm;
        acc += a[y * w + Math.min(x + r + 1, w - 1)] - a[y * w + Math.max(x - r, 0)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(Math.max(y, 0), h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc * norm;
        acc += b[Math.min(y + r + 1, h - 1) * w + x] - b[Math.max(y - r, 0) * w + x];
      }
    }
  }
  return a;
}

/**
 * A rounded relief from a silhouette: inner pixels bulge forward, edges fall
 * away. Lets a flat cut-out turn in 3D convincingly.
 */
export function reliefFromMask(mask: Uint8Array, w: number, h: number, openBottom: boolean, smoothing: number): Float32Array {
  const dist = blur(distanceField(mask, w, h, openBottom), w, h, smoothing);
  let max = 0;
  for (let i = 0; i < dist.length; i++) max = Math.max(max, dist[i]);
  const out = new Float32Array(dist.length);
  for (let i = 0; i < dist.length; i++) out[i] = mask[i] ? Math.sqrt(dist[i] / (max || 1)) : 0;
  return out;
}

/** Lambert shading of a height field, lit from the upper left. */
export function shadeRelief(depth: Float32Array, mask: Uint8Array, w: number, h: number, strength: number): Float32Array {
  const light = normalize([-0.45, 0.55, 0.7]);
  const out = new Float32Array(depth.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const dx = depth[y * w + Math.min(x + 1, w - 1)] - depth[y * w + Math.max(x - 1, 0)];
      const dy = depth[Math.min(y + 1, h - 1) * w + x] - depth[Math.max(y - 1, 0) * w + x];
      const n = normalize([-dx * strength, dy * strength, 1]);
      const lambert = Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
      const rim = Math.pow(1 - n[2], 2) * 0.35;
      out[i] = Math.min(1, 0.18 + lambert * 0.82 + rim);
    }
  }
  return out;
}

/**
 * Cuts a subject out of a plain light background (office wall, studio white):
 * floods inward from the image edges through bright, colourless pixels, then
 * keeps the largest remaining shape. Dark hair, skin and clothing all stop
 * the flood; stray background objects that survive are dropped as islands.
 */
export function keyLightBackground(luma: Float32Array, chroma: Float32Array, w: number, h: number): Uint8Array {
  const n = w * h;
  const background = new Uint8Array(n);
  const isBackgroundLike = (i: number) => chroma[i] < 0.11 && luma[i] > 0.42;
  const stack: number[] = [];
  const visit = (i: number) => {
    if (!background[i] && isBackgroundLike(i)) {
      background[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    visit(x);
    visit((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    visit(y * w);
    visit(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i < n - w) visit(i + w);
  }

  // Largest connected non-background region = the subject.
  const label = new Int32Array(n).fill(-1);
  let best = -1;
  let bestSize = 0;
  for (let seed = 0, next = 0; seed < n; seed++) {
    if (background[seed] || label[seed] >= 0) continue;
    let size = 0;
    label[seed] = next;
    stack.push(seed);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < n - w ? i + w : -1]) {
        if (j >= 0 && !background[j] && label[j] < 0) {
          label[j] = next;
          stack.push(j);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
    next++;
  }

  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = label[i] === best ? 1 : 0;
  return mask;
}

/**
 * Prepares photo brightness for dots: stretches the subject's own range to
 * full contrast, then boosts local detail (unsharp mask) so eyes, brows and
 * mouth stay legible once the image is reduced to scattered points.
 */
export function toneMap(luma: Float32Array, mask: Uint8Array, w: number, h: number, detail: number): Float32Array {
  const histogram = new Uint32Array(256);
  let count = 0;
  let sum = 0;
  for (let i = 0; i < luma.length; i++) {
    if (!mask[i]) continue;
    histogram[Math.min(255, Math.floor(luma[i] * 256))]++;
    count++;
    sum += luma[i];
  }
  const percentile = (p: number) => {
    let acc = 0;
    for (let b = 0; b < 256; b++) {
      acc += histogram[b];
      if (acc >= count * p) return b / 255;
    }
    return 1;
  };
  const lo = percentile(0.02);
  const hi = percentile(0.98);
  const mean = count ? sum / count : 0.5;

  // Background set to the subject's mean so the blur doesn't halo the edges.
  const stretched = new Float32Array(luma.length);
  for (let i = 0; i < luma.length; i++) {
    const l = mask[i] ? luma[i] : mean;
    stretched[i] = Math.min(1, Math.max(0, (l - lo) / Math.max(hi - lo, 0.01)));
  }
  const soft = blur(stretched, w, h, 4, 2);
  const out = new Float32Array(luma.length);
  for (let i = 0; i < luma.length; i++) {
    out[i] = Math.min(1, Math.max(0, stretched[i] + detail * (stretched[i] - soft[i])));
  }
  return out;
}

function normalize(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
