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
}

export function sampleRaster(raster: Raster, count: number, depthScale: number): PointCloud {
  const { width: w, height: h, weight, luma: pixelLuma, depth } = raster;
  const n = w * h;
  const cdf = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += weight[i];
    cdf[i] = total;
  }

  const positions = new Float32Array(count * 3);
  const luma = new Float32Array(count);
  for (let k = 0; k < count; k++) {
    const target = Math.random() * total;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cdf[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const x = (lo % w) + Math.random();
    const y = Math.floor(lo / w) + Math.random();
    positions[k * 3] = (x - w / 2) / h;
    positions[k * 3 + 1] = (h / 2 - y) / h;
    positions[k * 3 + 2] = (depth[lo] - 0.5) * depthScale + (Math.random() - 0.5) * 0.008;
    luma[k] = pixelLuma[lo];
  }
  return { count, positions, luma };
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
  order.forEach((from, to) => {
    positions[to * 3] = cloud.positions[from * 3];
    positions[to * 3 + 1] = cloud.positions[from * 3 + 1];
    positions[to * 3 + 2] = cloud.positions[from * 3 + 2];
    luma[to] = cloud.luma[from];
  });
  return { count: cloud.count, positions, luma };
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

function normalize(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
