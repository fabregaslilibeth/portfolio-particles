import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Geometry, Position } from 'geojson';
import land110 from 'world-atlas/land-110m.json';
import country from 'virtual:country';
import { config, type PortraitMode } from '../config';
import {
  blur,
  distanceField,
  ditherRaster,
  keyLightBackground,
  rasterFromAlpha,
  reliefFromMask,
  sampleRaster,
  shadeRelief,
  sortByHeight,
  toneMap,
  type PointCloud,
  type Raster,
} from './sampler';

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
  /** A phone, 1 tall, centred on the origin, with real thickness. */
  phone: PointCloud;
}

type Country = typeof country;

/** Lets the browser paint (and the loading name animate) between heavy steps. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Builds every scroll shape. `onProgress` reports 0..1 as each step lands, so
 * the loading name can assemble in step with the real work.
 */
export async function buildShapes(count: number, onProgress: (done: number) => void = () => {}): Promise<Shapes> {
  const { src, mode, depthSrc, depth } = config.portrait;
  onProgress(0.05);
  // A photo that fails to load falls back to the placeholder bust.
  const portraitRaster = src ? await photoRaster(src, mode, depthSrc).catch(() => placeholderBust()) : placeholderBust();
  onProgress(0.4);
  await breathe();
  const portrait = sortByHeight(ditherRaster(portraitRaster, count, depth));
  onProgress(0.6);
  await breathe();
  const globe = sortByHeight(globeCloud(count));
  onProgress(0.75);
  await breathe();
  const countryRaster = rasteriseCountry(country);
  const countryCloud = sortByHeight(sampleRaster(countryRaster, count, 0.06));
  onProgress(0.88);
  await breathe();
  const phone = sortByHeight(phoneCloud(count));
  onProgress(1);

  return {
    count,
    portrait,
    portraitAspect: portraitRaster.width / portraitRaster.height,
    globe,
    country: countryCloud,
    countryAspect: countryRaster.width / countryRaster.height,
    countryFocus: country.focus,
    phone,
  };
}

// ---------- Intro: words in dots (the name, then the job title) ----------

export interface TextShape {
  /** Per particle: x, y (height-normalised), brightness. Brightness 0 = not part of the text. */
  points: Float32Array;
  /** Width / height of the lettering. */
  aspect: number;
}

/**
 * A line of text spelled out in dots, in the site's type style: the last word
 * in the italic serif accent ("Beth *Fabregas*", "Creative *Developer*").
 * About 40% of particles form the letters (more would blow out to solid
 * white); the rest stay scattered as faint dust. Every text uses the same
 * particles for its letters, so one word can re-form straight into another.
 */
export async function textShape(count: number, text: string, twoLines: boolean): Promise<TextShape> {
  const sans = '500 160px "Inter Tight"';
  const serif = 'italic 400 182px "Instrument Serif"';
  // Don't hold the loader hostage to a slow font server.
  await Promise.race([
    Promise.all([document.fonts.load(sans), document.fonts.load(serif)]),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]).catch(() => undefined);

  const words = text.trim().split(/\s+/).filter(Boolean);
  const last = words.length > 1 ? words.pop() ?? '' : '';
  const first = words.join(' ');
  const probe = canvas2d(8, 8);
  const widthOf = (text: string, font: string) => {
    probe.font = font;
    return probe.measureText(text).width;
  };
  const gap = last ? 44 : 0;
  const firstW = widthOf(first, sans);
  const lastW = last ? widthOf(last, serif) : 0;
  const lineH = 200;
  const pad = 30;
  const w = Math.ceil((twoLines ? Math.max(firstW, lastW) : firstW + gap + lastW) + pad * 2);
  const h = (twoLines && last ? lineH * 2 : lineH) + pad * 2;

  const ctx = canvas2d(w, h);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  if (twoLines && last) {
    ctx.textAlign = 'center';
    ctx.font = sans;
    ctx.fillText(first, w / 2, pad + lineH * 0.5);
    ctx.font = serif;
    ctx.fillText(last, w / 2, pad + lineH * 1.5);
  } else {
    ctx.textAlign = 'left';
    ctx.font = sans;
    ctx.fillText(first, pad, h / 2);
    ctx.font = serif;
    ctx.fillText(last, pad + firstW + gap, h / 2 + 6);
  }

  const textShare = 0.4;
  const textCount = Math.round(count * textShare);
  const letters = sortByHeight(ditherRaster(rasterFromAlpha(ctx, w, h), textCount, 0));

  // Spread the letter particles evenly through the index range, top rows
  // first, so they line up with the (also top-sorted) portrait later.
  const points = new Float32Array(count * 3);
  let k = 0;
  for (let i = 0; i < count && k < textCount; i++) {
    if ((i * 0.6180339887) % 1 >= textShare) continue;
    points[i * 3] = letters.positions[k * 3];
    points[i * 3 + 1] = letters.positions[k * 3 + 1];
    points[i * 3 + 2] = 0.85 + 0.15 * Math.random();
    k++;
  }
  return { points, aspect: w / h };
}

// ---------- Contact: a phone ----------

const PHONE_W = 360;
const PHONE_H = 740;
/** Body depth relative to its height (a real phone is ~1:19). */
const PHONE_DEPTH = 0.05;

/**
 * A smartphone showing a chat — body, camera pill, status bar, message
 * bubbles, typing dots, input bar — plus dotted side walls so it has real
 * thickness when it tilts. 1 tall, centred on the origin.
 */
function phoneCloud(count: number): PointCloud {
  const W = PHONE_W;
  const H = PHONE_H;
  const ctx = canvas2d(W, H);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const box = (x: number, y: number, w: number, h: number, radius: number, fill: number, line: number, width = 2.5) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    if (fill) {
      ctx.globalAlpha = fill;
      ctx.fill();
    }
    if (line) {
      ctx.globalAlpha = line;
      ctx.lineWidth = width;
      ctx.stroke();
    }
  };
  const bar = (x: number, y: number, w: number, thickness: number, alpha: number) => box(x, y, w, thickness, thickness / 2, alpha, 0);
  const dot = (x: number, y: number, r: number, fill: number, line = 0) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) {
      ctx.globalAlpha = fill;
      ctx.fill();
    }
    if (line) {
      ctx.globalAlpha = line;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  };

  // Body, screen edge, camera pill, home indicator.
  box(6, 6, W - 12, H - 12, 56, 0.015, 1, 5);
  box(20, 20, W - 40, H - 40, 44, 0, 0.4, 2);
  bar(W / 2 - 48, 34, 96, 28, 0.95);
  bar(W / 2 - 56, H - 42, 112, 6, 0.8);

  // Status bar: time, signal, battery.
  bar(44, 42, 36, 11, 0.85);
  for (let i = 0; i < 4; i++) bar(W - 112 + i * 7, 52 - i * 3, 4, 4 + i * 3, 0.85);
  box(W - 74, 40, 30, 15, 4, 0, 0.85, 2);
  bar(W - 71, 43, 20, 9, 0.85);

  // Chat header: back chevron, avatar, name, status, call icon.
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(42, 110);
  ctx.lineTo(32, 122);
  ctx.lineTo(42, 134);
  ctx.stroke();
  dot(78, 122, 20, 0.35, 0.9);
  bar(108, 112, 110, 12, 0.9);
  bar(108, 130, 64, 7, 0.45);
  dot(W - 48, 122, 11, 0, 0.6);
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(28, 160);
  ctx.lineTo(W - 28, 160);
  ctx.stroke();

  // The conversation: received bubbles on the left, sent ones on the right.
  let y = 186;
  const bubble = (side: 'in' | 'out', w: number, lines: number) => {
    const h = 26 + lines * 16;
    const x = side === 'in' ? 36 : W - 36 - w;
    box(x, y, w, h, 18, side === 'in' ? 0.1 : 0.3, side === 'in' ? 0.75 : 0.9);
    for (let i = 0; i < lines; i++) {
      const lineW = (w - 32) * (i === lines - 1 && lines > 1 ? 0.6 : 1);
      bar(x + 16, y + 16 + i * 16, lineW, 6, side === 'in' ? 0.6 : 0.95);
    }
    y += h + 16;
  };
  bubble('in', 200, 2);
  bubble('out', 150, 1);
  bubble('in', 236, 3);
  bubble('out', 206, 2);
  // Typing indicator.
  box(36, y, 76, 38, 19, 0.1, 0.75);
  for (let i = 0; i < 3; i++) dot(58 + i * 16, y + 19, 4.5, 0.9);

  // Input bar and send button.
  box(32, H - 120, W - 112, 46, 23, 0.04, 0.7);
  bar(52, H - 101, 92, 7, 0.4);
  dot(W - 54, H - 97, 23, 0.85);

  const front = rasterFromAlpha(ctx, W, H);
  for (let i = 0; i < front.luma.length; i++) front.luma[i] *= 0.75;

  // Side walls: the body outline, repeated through the phone's depth.
  const rim = canvas2d(W, H);
  rim.strokeStyle = '#fff';
  rim.lineWidth = 4;
  rim.beginPath();
  rim.roundRect(6, 6, W - 12, H - 12, 56);
  rim.stroke();
  const sideCount = Math.round(count * 0.1);
  const sides = ditherRaster(rasterFromAlpha(rim, W, H), sideCount, 0);
  const face = ditherRaster(front, count - sideCount, 0);

  const positions = new Float32Array(count * 3);
  const luma = new Float32Array(count);
  for (let i = 0; i < face.count; i++) {
    positions[i * 3] = face.positions[i * 3];
    positions[i * 3 + 1] = face.positions[i * 3 + 1];
    positions[i * 3 + 2] = PHONE_DEPTH / 2;
    luma[i] = face.luma[i];
  }
  for (let k = 0; k < sides.count; k++) {
    const i = face.count + k;
    positions[i * 3] = sides.positions[k * 3];
    positions[i * 3 + 1] = sides.positions[k * 3 + 1];
    positions[i * 3 + 2] = PHONE_DEPTH / 2 - Math.random() * PHONE_DEPTH;
    luma[i] = 0.45;
  }
  return { count, positions, luma };
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

/**
 * 'auto' picks a mode from the image itself: real transparency → 'alpha';
 * otherwise a bright frame edge → 'light', a dark one → 'luma'.
 */
function detectMode(alpha: Float32Array, luma: Float32Array, w: number, h: number): Exclude<PortraitMode, 'auto'> {
  let transparent = 0;
  for (let i = 0; i < alpha.length; i++) if (alpha[i] < 0.98) transparent++;
  if (transparent > alpha.length * 0.02) return 'alpha';
  // The bottom edge is usually the subject's cropped body, so it's ignored.
  const edge: number[] = [];
  for (let x = 0; x < w; x++) edge.push(luma[x]);
  for (let y = 0; y < h; y++) edge.push(luma[y * w], luma[y * w + w - 1]);
  edge.sort((a, b) => a - b);
  return edge[edge.length >> 1] > 0.5 ? 'light' : 'luma';
}

async function photoRaster(src: string, mode: PortraitMode, depthSrc: string | null): Promise<Raster> {
  const img = await loadImage(src);
  const h = 560;
  const w = Math.round((img.naturalWidth / img.naturalHeight) * h);
  const ctx = canvas2d(w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const n = w * h;
  const alpha = new Float32Array(n);
  const luma = new Float32Array(n);
  const chroma = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    alpha[i] = data[i * 4 + 3] / 255;
    luma[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    chroma[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }

  // How much of each pixel is the subject, 0..1.
  let coverage: Float32Array;
  switch (mode === 'auto' ? detectMode(alpha, luma, w, h) : mode) {
    case 'alpha':
      coverage = alpha;
      break;
    case 'light':
      // Softened by a pixel so the outline isn't a hard staircase of dots.
      coverage = blur(Float32Array.from(keyLightBackground(luma, chroma, w, h)), w, h, 1, 1);
      break;
    case 'luma':
      coverage = luma.map((l) => Math.min(1, Math.max(0, (l - 0.08) / 0.08)));
      break;
  }

  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = coverage[i] > 0.5 ? 1 : 0;
  const { detail, shadowDots, contrast, bottomFade } = config.portrait;
  const tone = toneMap(luma, mask, w, h, detail);
  const weight = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Fade the lowest third so the face, not the torso, holds the eye.
    const t = Math.min(1, Math.max(0, (Math.floor(i / w) / h - 0.68) / 0.32));
    const fade = 1 - bottomFade * t * t * (3 - 2 * t);
    weight[i] = coverage[i] * fade * (shadowDots + (1 - shadowDots) * Math.pow(tone[i], contrast));
    tone[i] *= fade;
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
  return { width: w, height: h, weight, luma: tone, depth };
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
export function scatter(count: number): Float32Array {
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
