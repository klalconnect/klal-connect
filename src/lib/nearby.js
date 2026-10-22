// "Near you": listings ranked by how far they are from the person, and only
// the ones close enough to be worth a drive.
//
// The "Near you" sections on Home, the welcome screen and Resources used to
// show the most-used or newest listings on the whole site, wherever they
// were, so a new member in Brooklyn was greeted by the Bahamas and
// Minneapolis. Now each listing is placed on the map (its own pin if it has
// one, else the centre of its city from @/data/cityCoords) and measured from
// the person. The nearest fill the section, reaching out to neighbouring
// towns when the person's own has too few; past NEAR_MILES nothing counts,
// and a section with nothing that close is not shown at all.

import CITY_COORDS from '../data/cityCoords.js';
import { countryOf, countryName, US } from './countries.js';
import { stateName } from './place.js';

// About an hour's drive: Lakewood and Monsey are near Brooklyn, Miami is near
// Boca Raton, Philadelphia is not near New York.
export const NEAR_MILES = 60;

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\./g, '').replace(/[^a-z0-9א-ת]+/g, ' ').trim();

/**
 * The lookup keys for a city: "brooklyn|United States|new york" and, as a
 * fallback for a US listing that names no state, "brooklyn|United States".
 * The build script (scripts/build-city-coords.mjs) writes the table with these
 * same keys.
 */
export function areaKeys({ city, state, country }) {
  const c = norm(city);
  if (!c) return [];
  const nation = countryName(country) || String(country || '').trim();
  if (nation !== US) return [`${c}|${nation}`];
  const st = norm(stateName(state) || state);
  return st ? [`${c}|${US}|${st}`, `${c}|${US}`] : [`${c}|${US}`];
}

const coord = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

function cityCentre(place) {
  for (const key of areaKeys(place)) {
    const hit = CITY_COORDS[key];
    if (hit) return { lat: hit[0], lng: hit[1] };
  }
  return null;
}

/** Where a listing is: its own pin, else the centre of its city, else null. */
export function listingPoint(p) {
  const lat = coord(p?.latitude), lng = coord(p?.longitude);
  if (lat != null && lng != null && !(lat === 0 && lng === 0)) return { lat, lng };
  return cityCentre({ city: p?.city, state: p?.state, country: countryOf(p) });
}

/**
 * Where a person is, from whatever is known: coordinates (a member's saved
 * location, or the browser's), else a city name. A bare city with no country
 * ("Brooklyn", a Home chip) is looked up in the US first, then anywhere.
 */
export function placePoint({ lat, lng, city, state, country } = {}) {
  if (coord(lat) != null && coord(lng) != null) return { lat: Number(lat), lng: Number(lng) };
  if (!city) return null;
  const nation = countryName(country) || '';
  if (nation) return cityCentre({ city, state, country: nation });
  // "Brooklyn, NY" from a chip or a link.
  const [name, region] = String(city).split(/,\s*/);
  const asState = stateName(region || '');
  const asCountry = region && !asState ? countryName(region) : '';
  if (asCountry) return cityCentre({ city: name, country: asCountry });
  const us = cityCentre({ city: name, state: asState, country: US });
  if (us) return us;
  const c = norm(name);
  const key = Object.keys(CITY_COORDS).find((k) => k.split('|')[0] === c);
  return key ? { lat: CITY_COORDS[key][0], lng: CITY_COORDS[key][1] } : null;
}

// Kept here rather than imported from @/lib/userLocation, which needs the
// API client and React: this file is also run by the build script under Node.
const rad = (d) => (d * Math.PI) / 180;
function milesBetween(lat1, lng1, lat2, lng2) {
  const h = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * The listings within NEAR_MILES of `origin`, nearest first. Listings in the
 * same town come before the next town over; within a town, `rank` (most used,
 * newest...) decides. Empty when `origin` is unknown or nothing is that close.
 */
export function nearbyListings(providers, origin, { rank = null, maxMiles = NEAR_MILES } = {}) {
  if (!origin) return [];
  const found = [];
  for (const p of providers) {
    const at = listingPoint(p);
    if (!at) continue;
    const miles = milesBetween(origin.lat, origin.lng, at.lat, at.lng);
    if (miles <= maxMiles) found.push({ p, miles });
  }
  // Rounded to the town (about 3 miles), so "same town" is one band and the
  // section's own order applies inside it.
  const band = (m) => Math.floor(m / 3);
  return found
    .sort((a, b) => band(a.miles) - band(b.miles) || (rank ? rank(a.p, b.p) : 0) || a.miles - b.miles)
    .map(({ p }) => p);
}
