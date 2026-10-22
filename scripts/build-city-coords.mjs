// Rebuilds src/data/cityCoords.js: the centre of every city that has a
// listing, so "Near you" can measure distances without a geocoder (most
// listings have no pin of their own).
//
//   npm i --no-save all-the-cities@3.1.0
//   curl -s 'https://klalconnect.org/api/entities/Provider?query=%7B%22status%22%3A%22published%22%7D' -o /tmp/listings.json
//   node scripts/build-city-coords.mjs /tmp/listings.json
//
// Cities are matched by name within the listing's country (and state, in the
// US), the most populous match winning. A listing in a city this misses is
// simply left out of "Near you" until the table is rebuilt, or it gets a pin.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { COUNTRIES, countryOf, US } from '../src/lib/countries.js';
import { stateName } from '../src/lib/place.js';
import { PLACES } from '../server/places.js';

const require = createRequire(import.meta.url);
const listings = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
// The table must use the app's own keys, so they are imported, not copied.
const { areaKeys } = await import('../src/lib/nearby.js').catch(() => ({}));

const CODE = new Map(COUNTRIES.map(([code, name]) => [name, code]));
const STATE_CODE = Object.fromEntries(('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM ' +
  'NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY').split(' ').map((c) => [stateName(c).toLowerCase(), c]));
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\./g, '').replace(/[^a-z0-9א-ת]+/g, ' ').trim();

// What listings call a place that the world list spells otherwise.
const SAME = {
  'פ ת': 'petah tikva', 'ב ב': 'bnei brak', 'ר ג': 'ramat gan', 'י ם': 'jerusalem', 'ת א': 'tel aviv',
  'tel aviv yafo': 'tel aviv', 'bet shemesh': 'beit shemesh', 'betar illit': 'beitar illit',
  'modi in maccabim re ut': "modiin", 'giv at shmuel': 'givat shmuel', 'ra anana': "ra'anana",
  'boro park': 'borough park', 'new york': 'new york city', 'bronx': 'the bronx', 'roma': 'rome', 'wien': 'vienna',
  'moskva': 'moscow', 'milano': 'milan', 'mexico df': 'mexico city', 'mexico': 'mexico city', 'raanana': "ra'anana",
  'petach tikva': 'petah tikva', 'ב ש': 'beit shemesh', 'כ ס': 'kfar saba', 'ראשל צ': 'rishon letsiyyon',
};

// Neighbourhoods and small towns listings name that the world list lacks.
const EXTRA = [
  ['Flushing', 'US', 'NY', 40.7675, -73.8331], ['Bedford Stuyvesant', 'US', 'NY', 40.6872, -73.9418],
  ['LIC', 'US', 'NY', 40.7447, -73.9485], ['Gowanus', 'US', 'NY', 40.6733, -73.99], ['Mapleton', 'US', 'NY', 40.6045, -73.994],
  ['Madison', 'US', 'NY', 40.607, -73.948], ['Woodridge', 'US', 'NY', 41.71, -74.574], ['Swan Lake', 'US', 'NY', 41.75, -74.78],
  ['Woodbourne', 'US', 'NY', 41.76, -74.6], ['Tarzana', 'US', 'CA', 34.1736, -118.5537], ['Central LA', 'US', 'CA', 34.05, -118.3],
  ['Downtown Los Angeles', 'US', 'CA', 34.04, -118.25], ['Southwest Houston', 'US', 'TX', 29.68, -95.52],
  ['St Louis Park', 'US', 'MN', 44.948, -93.348], ['West Bloomfield', 'US', 'MI', 42.568, -83.383],
  ['Nautilus', 'US', 'FL', 25.81, -80.13], ['Brighton', 'US', 'MA', 42.35, -71.156], ['Cross Country', 'US', 'MD', 39.37, -76.7],
  ['Clapton', 'GB', '', 51.56, -0.06], ['Cazenove', 'GB', '', 51.565, -0.07], ['Sandton', 'ZA', '', -26.107, 28.057],
  ['Givat Shmuel', 'IL', '', 32.077, 34.849], ['Giv at Shmuel', 'IL', '', 32.077, 34.849], ['Givat Zeev', 'IL', '', 31.86, 35.17],
  ['Giv at Ze ev', 'IL', '', 31.86, 35.17], ['Zikhron Ya akov', 'IL', '', 32.57, 34.95], ['Sha alvim', 'IL', '', 31.87, 34.98],
];

const byName = new Map();
const add = (name, row) => { const k = norm(name); if (!k) return; if (!byName.has(k)) byName.set(k, []); byName.get(k).push(row); };
for (const row of require('all-the-cities')) {
  add(row.name, row);
  for (const alt of String(row.altName || '').split(',')) add(alt, row);
}
for (const [city, country, adminCode, lat, lng] of EXTRA) {
  add(city, { country, adminCode, population: 2e9, loc: { coordinates: [lng, lat] } });
}
for (const p of PLACES) {
  const row = { country: p.country_code, adminCode: p.region, population: 1e9, loc: { coordinates: [p.longitude, p.latitude] } };
  add(p.city, row);
  for (const a of p.aka || []) add(a, row);
}

const round = (n) => Math.round(n * 1000) / 1000;
const table = {};
let hits = 0, misses = 0;
const missed = new Map();
const counts = new Map();
for (const p of listings) {
  const place = { city: p.city, state: p.state, country: countryOf(p) };
  const keys = areaKeys(place);
  if (keys[0]) counts.set(keys[0], (counts.get(keys[0]) || 0) + 1);
  if (!keys.length || keys.every((k) => table[k])) { if (keys.length) hits++; continue; }
  const cc = CODE.get(place.country) || '';
  const st = STATE_CODE[String(stateName(p.state) || '').toLowerCase()] || '';
  const name = norm(p.city);
  const pool = byName.get(norm(SAME[name] || name)) || byName.get(name.replace(/ (city|village|township)$/, '')) || [];
  const fits = pool.filter((r) => (!cc || r.country === cc) && (cc !== 'US' || !st || r.adminCode === st))
    .sort((a, b) => b.population - a.population);
  const best = fits[0];
  if (!best) { misses++; const k = keys[0]; missed.set(k, (missed.get(k) || 0) + 1); continue; }
  hits++;
  const at = [round(best.loc.coordinates[1]), round(best.loc.coordinates[0])];
  table[keys[0]] = at;
}

// A US city named with no state ("Lakewood") is the one with the most
// listings: Lakewood, New Jersey, not Lakewood, Ohio.
const busiest = new Map();
for (const key of Object.keys(table)) {
  const parts = key.split('|');
  if (parts[1] !== US || parts.length < 3) continue;
  const bare = parts.slice(0, 2).join('|');
  const best = busiest.get(bare);
  if (!best || (counts.get(key) || 0) > (counts.get(best) || 0)) busiest.set(bare, key);
}
for (const [bare, key] of busiest) table[bare] = table[key];

const sorted = Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(new URL('../src/data/cityCoords.js', import.meta.url),
  '// Generated by scripts/build-city-coords.mjs — the centre of each city that has a listing, as [lat, lng].\n'
  + '// Keys come from areaKeys() in @/lib/nearby. Do not edit by hand; rebuild instead.\n'
  + `export default ${JSON.stringify(sorted)};\n`);
console.log(`${Object.keys(sorted).length} cities; ${hits} listings placed, ${misses} not`);
console.log([...missed].sort((a, b) => b[1] - a[1]).slice(0, 40));
