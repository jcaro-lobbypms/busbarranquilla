/**
 * renameStops.ts
 *
 * Renames all stops that have generic names ("Parada N") with real street
 * addresses fetched from Nominatim reverse geocoding.
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/renameStops.ts
 *
 * Safe to re-run: only updates stops whose name matches /^Parada \d+$/i
 * Rate-limited to 1 request/second to respect Nominatim's usage policy.
 */

import axios from 'axios';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

interface Stop {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  stop_order: number;
  route_id: number;
}

interface NominatimAddress {
  road?: string;
  pedestrian?: string;
  footway?: string;
  path?: string;
  neighbourhood?: string;
  suburb?: string;
  quarter?: string;
  city_district?: string;
  display_name?: string;
}

interface NominatimResponse {
  address?: NominatimAddress;
  display_name?: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function buildStopName(address: NominatimAddress, fallback: string): string {
  // Best: road name
  const road =
    address.road ??
    address.pedestrian ??
    address.footway ??
    address.path;

  // Secondary: neighbourhood/suburb
  const area =
    address.neighbourhood ??
    address.suburb ??
    address.quarter ??
    address.city_district;

  if (road && area) return `${road}, ${area}`;
  if (road) return road;
  if (area) return area;

  // Fallback: first segment of display_name (before first comma)
  if (fallback) {
    const first = fallback.split(',')[0].trim();
    if (first.length > 0 && first.length < 60) return first;
  }

  return fallback;
}

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const response = await axios.get<NominatimResponse>(
      'https://nominatim.openstreetmap.org/reverse',
      {
        params: {
          lat,
          lon: lng,
          format: 'jsonv2',
          addressdetails: 1,
        },
        headers: {
          'User-Agent': 'MiBusApp/1.0 (admin@mibus.co)',
          'Accept-Language': 'es',
        },
        timeout: 10000,
      }
    );

    const data = response.data;
    if (!data) return null;

    const address = data.address ?? {};
    const displayName = data.display_name ?? '';
    return buildStopName(address, displayName);
  } catch {
    return null;
  }
}

async function run(): Promise<void> {
  console.log('🔍 Fetching stops with generic names...');

  const { rows: stops } = await pool.query<Stop>(
    `SELECT id, name, latitude, longitude, stop_order, route_id
     FROM stops
     WHERE name ~* '^Parada \\d+$'
     ORDER BY route_id, stop_order`
  );

  if (stops.length === 0) {
    console.log('✅ No stops with generic names found. Nothing to do.');
    await pool.end();
    return;
  }

  console.log(`📍 Found ${stops.length} stops to rename.\n`);

  let updated = 0;
  let failed = 0;

  for (const stop of stops) {
    process.stdout.write(
      `  [${stop.route_id}] #${stop.stop_order} (${stop.latitude}, ${stop.longitude}) → `
    );

    const newName = await reverseGeocode(stop.latitude, stop.longitude);

    if (newName && newName !== stop.name) {
      await pool.query('UPDATE stops SET name = $1 WHERE id = $2', [newName, stop.id]);
      console.log(`"${newName}"`);
      updated++;
    } else {
      console.log(`(no change — kept "${stop.name}")`);
      failed++;
    }

    // Respect Nominatim rate limit: 1 req/sec
    await sleep(1100);
  }

  console.log(`\n✅ Done. Updated: ${updated}, Skipped: ${failed}`);
  await pool.end();
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
