// Every town in the world of about a thousand people or more, answered in
// process. The curated list in ./places.js knows the communities Klal is for;
// this knows everywhere else, so a member in Deerfield Beach or Boise can pick
// their town with no geocoder key, no quota and no request leaving the server.
//
// The table (server/geo/worldCities.js, ~5 MB) is only loaded on the first
// lookup, so requests that never ask for a place do not pay for parsing it.
// Rebuild it with scripts/build-world-cities.mjs.
import { distanceKm } from './places.js';

const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[.'’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const countryNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; } })();
const countryName = (cc) => { try { return countryNames?.of(cc) || ''; } catch { return ''; } };

const STATE_NAMES = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california', CO: 'colorado', CT: 'connecticut',
  DE: 'delaware', DC: 'district of columbia', FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois',
  IN: 'indiana', IA: 'iowa', KS: 'kansas', KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland',
  MA: 'massachusetts', MI: 'michigan', MN: 'minnesota', MS: 'mississippi', MO: 'missouri', MT: 'montana',
  NE: 'nebraska', NV: 'nevada', NH: 'new hampshire', NJ: 'new jersey', NM: 'new mexico', NY: 'new york',
  NC: 'north carolina', ND: 'north dakota', OH: 'ohio', OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania',
  RI: 'rhode island', SC: 'south carolina', SD: 'south dakota', TN: 'tennessee', TX: 'texas', UT: 'utah',
  VT: 'vermont', VA: 'virginia', WA: 'washington', WV: 'west virginia', WI: 'wisconsin', WY: 'wyoming',
};

let towns = null;
// Towns by the first two letters of their folded name, so a lookup scans a
// few hundred rows rather than all of them.
let byStart = null;

async function load() {
  if (towns) return;
  const { default: text } = await import('./geo/worldCities.js');
  towns = [];
  byStart = new Map();
  for (const line of text.split('\n')) {
    const [city, country_code, region, lat, lng, population] = line.split('\t');
    const t = { city, country_code, region, latitude: Number(lat), longitude: Number(lng), population: Number(population), key: fold(city) };
    towns.push(t);
    const start = t.key.slice(0, 2);
    if (!byStart.has(start)) byStart.set(start, []);
    byStart.get(start).push(t);
  }
}

// What may follow a town's name to say which one: "FL", "Florida", "Israel",
// "UK". Each is a prefix test, so "boise i" already narrows to Idaho.
function qualifiers(t) {
  const out = [];
  if (t.region) out.push(t.region.toLowerCase());
  if (t.country_code === 'US') out.push(STATE_NAMES[t.region] || '', 'us', 'usa', 'united states');
  else out.push(t.country_code.toLowerCase(), fold(countryName(t.country_code)));
  if (t.country_code === 'GB') out.push('uk', 'england', 'scotland', 'wales');
  return out.filter(Boolean);
}

// "Deerfield Beach", "deerf", "boise id", "Boise, Idaho", "Netanya Israel".
// A town whose name starts with what was typed, the exact name first, then the
// biggest — so "spring" offers Springfield before a village called Springe.
//
// `country` (a code, "US") keeps to towns in that country. `near` ({ lat, lng })
// puts the closest first, among the biggest few dozen that match, so a hamlet
// next door does not crowd out the city people mean.
export async function findTowns(query, limit = 8, { country = '', near = null } = {}) {
  const q = fold(query);
  if (q.length < 2) return [];
  await load();
  const pool = byStart.get(q.slice(0, 2)) || [];
  const hits = [];
  for (const t of pool) {
    if (country && t.country_code !== country) continue;
    let exact, qualified = false;
    // An exact name only jumps the queue from four letters on: "boi" is
    // Boise first, not a village in Nigeria called Boi.
    if (t.key.startsWith(q)) exact = q.length >= 4 && t.key === q;
    else if (q.startsWith(`${t.key} `)) {
      // The rest of the query has to name this town's state or country.
      const rest = q.slice(t.key.length + 1);
      if (!qualifiers(t).some((w) => w.startsWith(rest))) continue;
      exact = qualified = true;
    } else continue;
    hits.push({ t, exact, qualified });
  }
  // The pool is already biggest first, and sort is stable.
  hits.sort((a, b) => Number(b.exact) - Number(a.exact));
  let picked = hits;
  if (near) {
    const km = (t) => distanceKm(near.lat, near.lng, t.latitude, t.longitude);
    picked = hits.slice(0, 40).sort((a, b) => Number(b.exact) - Number(a.exact) || km(a.t) - km(b.t));
  }
  // `qualified`: the query named this town's state or country as well.
  return picked.slice(0, limit).map(({ t, qualified }) => ({ ...t, qualified }));
}

// The nearest town to a point, for naming where "Use my location" landed when
// no geocoder is configured. Only a town close enough to be honest.
export async function nearestTown(latitude, longitude, maxKm = 30) {
  await load();
  let best = null;
  let bestKm = Infinity;
  for (const t of towns) {
    // A cheap box test first: 0.5 degrees is ~55km of latitude.
    if (Math.abs(t.latitude - latitude) > 0.5) continue;
    const km = distanceKm(latitude, longitude, t.latitude, t.longitude);
    // A bigger town a little further off is the name people use.
    const score = km - Math.min(10, Math.log10(Math.max(t.population, 1)) * 1.5);
    if (km <= maxKm && score < bestKm) { bestKm = score; best = t; }
  }
  return best;
}
