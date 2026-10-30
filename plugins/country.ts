// Extracts one country's outline from Natural Earth (via world-atlas, public
// domain data), projected and normalised so the browser can rasterise it and
// sample particles from it. Countries that cross the antimeridian (Fiji,
// Russia…) are not handled.
import { createRequire } from 'node:module';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { MultiPolygon, Polygon } from 'geojson';

export interface CountryShape {
  name: string;
  /** Centre as [lon, lat] degrees — the globe turns to face it. */
  focus: [number, number];
  /** Width / height of the projected outline. */
  aspect: number;
  /** Rings in a height-normalised, y-up space centred on the origin. */
  rings: number[][][];
}

const require = createRequire(import.meta.url);
const { feature } = require('topojson-client') as typeof import('topojson-client');

type Countries = Topology<{ countries: GeometryCollection<{ name: string }> }>;

export function extractCountry(wanted: string): CountryShape {
  const world = require('world-atlas/countries-10m.json') as Countries;
  const countries = feature(world, world.objects.countries).features;
  const query = wanted.trim().toLowerCase();
  const match = countries.find((f) => f.properties.name.toLowerCase() === query);

  if (!match || (match.geometry.type !== 'Polygon' && match.geometry.type !== 'MultiPolygon')) {
    const similar = countries
      .map((f) => f.properties.name)
      .filter((n) => n.toLowerCase().includes(query.slice(0, 3)))
      .slice(0, 8);
    throw new Error(`VITE_COUNTRY: no country named "${wanted}". Similar: ${similar.join(', ') || 'none'}`);
  }

  const geometry = match.geometry as Polygon | MultiPolygon;
  const rawRings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();

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
  const round = (n: number) => Math.round(n * 1e5) / 1e5;

  // Equirectangular, corrected by cos(latitude) so shapes aren't stretched.
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

  return {
    name: match.properties.name,
    focus: [round(midLon), round(midLat)],
    aspect: round(((maxLon - minLon) * kx) / height),
    rings,
  };
}
