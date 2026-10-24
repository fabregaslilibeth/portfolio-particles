import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Geometry, Position } from 'geojson';
import land110 from 'world-atlas/land-110m.json';
import countryData from '../data/country.json';
import { config, type PortraitMode } from '../config';
import { reliefFromMask, sampleRaster, shadeRelief, sortByHeight, blur, distanceField, type PointCloud, type Raster } from './sampler';

export interface Shapes {
  count: number;
  portrait: PointCloud;
  /** Width / height of the portrait, for fitting it to the viewport. */
  portraitAspect: number;
  /** Unit sphere. */
  globe: PointCloud;
  country: PointCloud;
  countryAspect: number;
  /** Country centre as [lon, lat] degrees — the globe turns to face it. */
  countryFocus: [number, number];
  /** Scattered start positions the particles swirl in from. */
  origin: Float32Array;
}

interface Country {
  name: string;
  focus: [number, number];
  aspect: number;
  rings: number[][][];
}

export async function buildShapes(count: number): Promise<Shapes> {
  const { src, mode, depthSrc, depth } = config.portrait;
  const portraitRaster = src ? await photoRaster(src, mode, depthSrc) : placeholderBust();
  const country = countryData as unknown as Country;
  const countryRaster = rasteriseCountry(country);

  return {
    count,
    portrait: sortByHeight(sampleRaster(portraitRaster, count, depth)),
    portraitAspect: portraitRaster.width / portraitRaster.height,
    globe: sortByHeight(globeCloud(count)),
    country: sortByHeight(sampleRaster(countryRaster, count, 0.06)),
    countryAspect: countryRaster.width / countryRaster.height,
    countryFocus: country.focus,
    origin: scatter(count),
  };
}

function canvas2d(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  return ctx;
}

/**
 * A neutral head-and-shoulders silhouette, shaded as if sculpted, standing in
 * until a real photo is configured.
 */
function placeholderBust(): Raster {
  const w = 500;
  const h = 575;
  const ctx = canvas2d(w, h);
  ctx.scale(w / 1000, h / 1150);
  ctx.fillStyle = '#fff';
  const ellipse = (x: number, y: number, rx: number, ry: number) => {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  ellipse(500, 300, 172, 182); // cranium
  ellipse(500, 380, 158, 200); // face
  ellipse(500, 470, 118, 130); // jaw
  ellipse(338, 400, 24, 50); // ears
  ellipse(662, 400, 24, 50);
  ctx.fillRect(424, 520, 152, 170); // neck
  ctx.beginPath();
  ctx.moveTo(20, 1150);
  ctx.bezierCurveTo(40, 890, 140, 770, 320, 735);
  ctx.bezierCurveTo(395, 720, 420, 680, 428, 630);
  ctx.lineTo(572, 630);
  ctx.bezierCurveTo(580, 680, 605, 720, 680, 735);
  ctx.bezierCurveTo(860, 770, 960, 890, 980, 1150);
  ctx.closePath();
  ctx.fill();

  const { data } = ctx.getImageData(0, 0, w, h);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  const depth = reliefFromMask(mask, w, h, true, 10);
  const luma = shadeRelief(depth, mask, w, h, 240);
  const weight = new Float32Array(w * h);
  for (let i = 0; i < weight.length; i++) weight[i] = mask[i] ? 0.1 + 0.9 * Math.pow(luma[i], 1.6) : 0;
  return { width: w, height: h, weight, luma, depth };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

async function photoRaster(src: string, mode: PortraitMode, depthSrc: string | null): Promise<Raster> {
  const img = await loadImage(src);
  const h = 560;
  const w = Math.round((img.naturalWidth / img.naturalHeight) * h);
  const ctx = canvas2d(w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const mask = new Uint8Array(w * h);
  const luma = new Float32Array(w * h);
  const weight = new Float32Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    const a = data[i * 4 + 3] / 255;
    const l = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
    luma[i] = l;
    if (mode === 'alpha') {
      mask[i] = a > 0.5 ? 1 : 0;
      weight[i] = a * (0.2 + 0.8 * l);
    } else {
      mask[i] = l > 0.12 ? 1 : 0;
      weight[i] = mask[i] ? Math.pow(l, 1.4) : 0;
    }
  }

  let depth: Float32Array;
  if (depthSrc) {
    const depthImg = await loadImage(depthSrc);
    const dctx = canvas2d(w, h);
    dctx.drawImage(depthImg, 0, 0, w, h);
    const d = dctx.getImageData(0, 0, w, h).data;
    depth = new Float32Array(w * h);
    for (let i = 0; i < depth.length; i++) depth[i] = mask[i] ? d[i * 4] / 255 : 0;
  } else {
    depth = reliefFromMask(mask, w, h, true, 10);
  }
  return { width: w, height: h, weight, luma, depth };
}

/** Rings of every polygon in a (Multi)Polygon / GeometryCollection. */
function ringsOf(geometry: Geometry): Position[][] {
  switch (geometry.type) {
    case 'Polygon':
      return geometry.coordinates;
    case 'MultiPolygon':
      return geometry.coordinates.flat();
    case 'GeometryCollection':
      return geometry.geometries.flatMap(ringsOf);
    default:
      return [];
  }
}

/**
 * Adds a lon/lat ring to the current equirectangular path. Rings that cross
 * the antimeridian (Russia, Fiji) are unwrapped and drawn again one world
 * width over; rings that circle a pole (Antarctica) are closed via the pole.
 */
function traceLonLatRing(ctx: CanvasRenderingContext2D, ring: Position[], W: number, H: number): void {
  const pts: [number, number][] = [];
  let shift = 0;
  ring.forEach(([lon, lat], i) => {
    if (i > 0) {
      const prev = ring[i - 1][0];
      if (lon - prev > 180) shift -= 360;
      else if (prev - lon > 180) shift += 360;
    }
    pts.push([lon + shift, lat]);
  });
  const drift = pts[pts.length - 1][0] - pts[0][0];
  if (Math.abs(drift) > 180) {
    const pole = pts.reduce((s, p) => s + p[1], 0) < 0 ? -90 : 90;
    pts.push([pts[pts.length - 1][0], pole], [pts[0][0], pole]);
  }
  for (const offset of [-360, 0, 360]) {
    pts.forEach(([lon, lat], i) => {
      const x = ((lon + offset + 180) / 360) * W;
      const y = ((90 - lat) / 180) * H;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
}

/**
 * A dotted Earth: ~70% of particles on land (bright), the rest spread thinly
 * over the oceans so the sphere still reads.
 */
function globeCloud(count: number): PointCloud {
  const W = 1024;
  const H = 512;
  const ctx = canvas2d(W, H);
  const topology = land110 as unknown as Topology<{ land: GeometryCollection }>;
  const land = feature(topology, topology.objects.land);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (const f of land.features) {
    for (const ring of ringsOf(f.geometry)) traceLonLatRing(ctx, ring, W, H);
  }
  ctx.fill('evenodd');
  const pixels = ctx.getImageData(0, 0, W, H).data;
  const isLand = (lon: number, lat: number) => {
    const x = Math.min(W - 1, Math.floor(((lon + Math.PI) / (Math.PI * 2)) * W));
    const y = Math.min(H - 1, Math.floor(((Math.PI / 2 - lat) / Math.PI) * H));
    return pixels[(y * W + x) * 4 + 3] > 127;
  };

  const landTarget = Math.round(count * 0.7);
  const positions = new Float32Array(count * 3);
  const luma = new Float32Array(count);
  let landN = 0;
  let oceanN = 0;
  let k = 0;
  while (k < count) {
    const y = Math.random() * 2 - 1;
    const lon = Math.random() * Math.PI * 2 - Math.PI;
    const lat = Math.asin(y);
    const onLand = isLand(lon, lat);
    if (onLand ? landN >= landTarget : oceanN >= count - landTarget) continue;
    if (onLand) landN++;
    else oceanN++;
    const r = Math.cos(lat);
    positions[k * 3] = r * Math.sin(lon);
    positions[k * 3 + 1] = y;
    positions[k * 3 + 2] = r * Math.cos(lon);
    luma[k] = onLand ? 0.72 + 0.28 * Math.random() : 0.1 + 0.12 * Math.random();
    k++;
  }
  return { count, positions, luma };
}

/** Rasterises the country outline; coastlines get extra, brighter particles. */
function rasteriseCountry(country: Country): Raster {
  const size = 900;
  const pad = 24;
  const w = Math.ceil(country.aspect * size) + pad * 2;
  const h = size + pad * 2;
  const ctx = canvas2d(w, h);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (const ring of country.rings) {
    ring.forEach(([x, y], i) => {
      const px = (x + country.aspect / 2) * size + pad;
      const py = (0.5 - y) * size + pad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
  }
  ctx.fill('evenodd');

  const { data } = ctx.getImageData(0, 0, w, h);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  const dist = distanceField(mask, w, h);
  const depth = reliefFromMask(mask, w, h, false, 3);
  const soft = blur(dist, w, h, 1, 1);
  const luma = new Float32Array(w * h);
  const weight = new Float32Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const coast = 1 - Math.min(soft[i] / 7, 1);
    luma[i] = 0.5 + 0.5 * coast;
    weight[i] = 0.5 + 1.6 * coast;
  }
  return { width: w, height: h, weight, luma, depth };
}

/** A thick spherical shell around the scene, kept clear of the camera. */
function scatter(count: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    let x = 0, y = 0, z = 0, l = 0;
    do {
      x = Math.random() * 2 - 1;
      y = Math.random() * 2 - 1;
      z = Math.random() * 2 - 1;
      l = Math.hypot(x, y, z);
    } while (l === 0 || l > 1);
    const r = (2.2 + 4.3 * Math.random()) / l;
    x *= r;
    y *= r;
    z *= r;
    if (z > 1.6) z = -z;
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  return out;
}
