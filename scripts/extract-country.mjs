// Extracts one country's outline from Natural Earth (via world-atlas, public
// domain data) into src/data/country.json, projected and normalised so the
// browser can rasterise it and sample particles from it.
//
//   npm run country -- "Philippines"
//
// Countries that cross the antimeridian (Fiji, Russia…) are not handled.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { feature } = require('topojson-client');
const world = require('world-atlas/countries-10m.json');

const wanted = (process.argv[2] ?? 'Philippines').toLowerCase();
const countries = feature(world, world.objects.countries).features;
const match = countries.find((f) => f.properties.name.toLowerCase() === wanted);

if (!match) {
  const close = countries
    .map((f) => f.properties.name)
    .filter((n) => n.toLowerCase().includes(wanted.slice(0, 3)))
    .slice(0, 10);
  console.error(`No country named "${wanted}". Similar: ${close.join(', ') || 'none'}`);
  process.exit(1);
}

const polygons =
  match.geometry.type === 'Polygon' ? [match.geometry.coordinates] : match.geometry.coordinates;
const rawRings = polygons.flat();

let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
for (const ring of rawRings) {
  for (const [lon, lat] of ring) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
}

const midLon = (minLon + maxLon) / 2;
const midLat = (minLat + maxLat) / 2;
const kx = Math.cos((midLat * Math.PI) / 180);
const height = maxLat - minLat;
const round = (n) => Math.round(n * 1e5) / 1e5;

// Equirectangular, corrected by cos(latitude) so shapes aren't stretched,
// scaled to a height of 1 and centred on the origin (y up).
const rings = rawRings
  .map((ring) => ring.map(([lon, lat]) => [round(((lon - midLon) * kx) / height), round((lat - midLat) / height)]))
  .filter((ring) => {
    // Drop specks too small to ever receive a particle.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of ring) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return (x1 - x0) * (y1 - y0) > 2e-6;
  });

const out = {
  name: match.properties.name,
  focus: [round(midLon), round(midLat)],
  aspect: round(((maxLon - minLon) * kx) / height),
  rings,
};

const target = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/country.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(out));
console.log(`${out.name}: ${rings.length} rings, ${rings.reduce((n, r) => n + r.length, 0)} points -> ${target}`);
