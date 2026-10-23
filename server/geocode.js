// Geocoding, proxied through our server.
//
// The browser must not call a geocoder directly:
//   * Nominatim's usage policy requires an identifying User-Agent and caps
//     traffic at ~1 request/second. A browser cannot set User-Agent at all, and
//     N users means N requests/second, so direct calls are non-compliant by
//     construction — which is what the app used to do.
//   * Commercial providers need an API key, which must never ship to a client.
//   * Calling out from the browser hands the user's exact coordinates (and, for
//     IP lookups, their IP) straight to a third party.
//
// Proxying fixes all three: one identified caller, one shared cache, one place
// to swap providers. Set KC_GEOCODER to move off Nominatim without touching
// application code.
import tzLookup from 'tz-lookup';
import { geoCache } from './db.js';

import { findPlaces, nearestPlace, placeLabel, distanceKm } from './places.js';
import { findTowns, nearestTown } from './worldCities.js';

const PROVIDER = (process.env.KC_GEOCODER || 'nominatim').toLowerCase();
const API_KEY = process.env.KC_GEOCODER_KEY || '';
const CONTACT = process.env.KC_GEOCODER_CONTACT || 'admin@example.com';
const USER_AGENT = process.env.KC_GEOCODER_UA || `Klal/1.0 (${CONTACT})`;
const LOCATION_UNAVAILABLE = 'Location lookup is temporarily unavailable.';

const REVERSE_TTL = 30 * 24 * 60 * 60 * 1000; // a place's name rarely changes
const SEARCH_TTL = 7 * 24 * 60 * 60 * 1000;
const IP_TTL = 24 * 60 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 8000;

class GeoError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.statusCode = statusCode;
  }
}

// ---- shared helpers ---------------------------------------------------------

async function getJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Nominatim rejects anonymous traffic; the others ignore this.
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      console.warn('[geocode] upstream rejected request', { provider: PROVIDER, status: res.status });
      throw new GeoError(LOCATION_UNAVAILABLE, res.status === 429 ? 429 : 503);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof GeoError) throw err;
    console.warn('[geocode] upstream request failed', { provider: PROVIDER, reason: err.name || 'unknown' });
    throw new GeoError(LOCATION_UNAVAILABLE, 503);
  } finally {
    clearTimeout(timer);
  }
}

// Nominatim allows at most one request per second, globally, per application.
// Serialize upstream calls behind a promise chain so bursts queue instead of
// getting us blocked.
let chain = Promise.resolve();
let lastCallAt = 0;
const MIN_GAP_MS = Number(process.env.KC_GEOCODER_MIN_GAP_MS || 1100);

function throttled(task) {
  const run = chain.then(async () => {
    const wait = Math.max(0, lastCallAt + MIN_GAP_MS - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    return task();
  });
  // Keep the chain alive even when one call rejects.
  chain = run.then(() => undefined, () => undefined);
  return run;
}

// Only the throttled providers need the queue; a paid API does not.
const needsThrottle = () => PROVIDER === 'nominatim';
const call = (task) => (needsThrottle() ? throttled(task) : task());

// Timezone is derived from coordinates rather than taken from the browser.
// Using the browser's zone is wrong the moment someone picks a city in another
// zone — and zmanim are computed from it, so that would silently produce the
// wrong candle-lighting time.
export function tzFor(latitude, longitude) {
  try {
    return tzLookup(Number(latitude), Number(longitude));
  } catch {
    return '';
  }
}

const firstOf = (...values) => values.find((v) => v !== undefined && v !== null && v !== '') || '';

// `precise` marks a result that is the address itself (a building or a
// business), not the town it is in. Only those are worth pinning a listing
// to; everything else lands on the middle of a city.
function place(latitude, longitude, { city, country_code, label, precise } = {}) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  return {
    latitude: lat,
    longitude: lon,
    city: city || '',
    country_code: (country_code || '').toUpperCase(),
    timezone: tzFor(lat, lon),
    label: label || city || '',
    precise: Boolean(precise),
  };
}

// Google reports failures in the body with a 200, so a bad key or a billing
// problem would otherwise read as "no results".
function googleStatus(d) {
  const status = d?.status;
  if (status === 'OK' || status === 'ZERO_RESULTS') return;
  const detail = d?.error_message ? ` — ${d.error_message}` : '';
  console.warn('[geocode] Google rejected response', { status, detail: d?.error_message || '' });
  throw new GeoError(LOCATION_UNAVAILABLE, 503);
}

const GOOGLE_PRECISE = new Set(['street_address', 'premise', 'subpremise', 'establishment', 'point_of_interest']);

function googleComponents(result) {
  const pick = (type) => (result.address_components || []).find((c) => c.types.includes(type));
  return {
    city: firstOf(
      pick('locality')?.long_name,
      pick('postal_town')?.long_name,
      pick('sublocality')?.long_name,
      pick('administrative_area_level_2')?.long_name
    ),
    country_code: pick('country')?.short_name,
  };
}

// ---- providers --------------------------------------------------------------

const providers = {
  nominatim: {
    async reverse(lat, lon) {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1&email=${encodeURIComponent(CONTACT)}`;
      const d = await getJSON(url);
      const a = d.address || {};
      return place(lat, lon, {
        city: firstOf(a.city, a.town, a.village, a.hamlet, a.suburb, a.county),
        country_code: a.country_code,
        label: d.display_name,
      });
    },
    async search(q, limit) {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=${limit}&addressdetails=1&email=${encodeURIComponent(CONTACT)}`;
      const rows = await getJSON(url);
      return (Array.isArray(rows) ? rows : []).map((r) => {
        const a = r.address || {};
        return place(r.lat, r.lon, {
          city: firstOf(a.city, a.town, a.village, a.hamlet, a.county, (r.display_name || '').split(',')[0]),
          country_code: a.country_code,
          label: r.display_name,
          precise: Boolean(a.house_number) || Number(r.place_rank) >= 28,
        });
      });
    },
  },

  mapbox: {
    async reverse(lat, lon) {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?types=place&access_token=${API_KEY}`;
      const d = await getJSON(url);
      const f = (d.features || [])[0] || {};
      const country = (f.context || []).find((c) => String(c.id).startsWith('country'));
      return place(lat, lon, {
        city: f.text || '',
        country_code: country?.short_code,
        label: f.place_name,
      });
    },
    async search(q, limit) {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?types=address,poi,place,locality,postcode&limit=${limit}&access_token=${API_KEY}`;
      const d = await getJSON(url);
      return (d.features || []).map((f) => {
        const country = (f.context || []).find((c) => String(c.id).startsWith('country'));
        return place(f.center[1], f.center[0], {
          // An address's own text is the street, so the city comes from the
          // context instead.
          city: (f.context || []).find((c) => String(c.id).startsWith('place'))?.text || f.text,
          country_code: country?.short_code,
          label: f.place_name,
          precise: (f.place_type || []).some((t) => t === 'address' || t === 'poi'),
        });
      });
    },
  },

  geoapify: {
    async reverse(lat, lon) {
      const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lon}&type=city&format=json&apiKey=${API_KEY}`;
      const d = await getJSON(url);
      const r = (d.results || [])[0] || {};
      return place(lat, lon, { city: firstOf(r.city, r.county), country_code: r.country_code, label: r.formatted });
    },
    async search(q, limit) {
      const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(q)}&limit=${limit}&format=json&apiKey=${API_KEY}`;
      const d = await getJSON(url);
      return (d.results || []).map((r) =>
        place(r.lat, r.lon, {
          city: firstOf(r.city, r.county),
          country_code: r.country_code,
          label: r.formatted,
          precise: Boolean(r.housenumber) || ['building', 'amenity'].includes(r.result_type),
        })
      );
    },
  },

  // Google's Geocoding API. Both directions return the same shape: a list of
  // results, each with address_components typed by kind. City is the
  // "locality" component, falling back to the wider administrative areas for
  // places that are not incorporated as one.
  google: {
    async reverse(lat, lon) {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&result_type=locality|postal_town|administrative_area_level_2&key=${API_KEY}`;
      const d = await getJSON(url);
      googleStatus(d);
      const r = (d.results || [])[0];
      if (!r) return place(lat, lon);
      const c = googleComponents(r);
      return place(lat, lon, { city: c.city, country_code: c.country_code, label: r.formatted_address });
    },
    async search(q, limit) {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${API_KEY}`;
      const d = await getJSON(url);
      googleStatus(d);
      return (d.results || []).slice(0, limit).map((r) => {
        const c = googleComponents(r);
        return place(r.geometry.location.lat, r.geometry.location.lng, {
          city: c.city || (r.formatted_address || '').split(',')[0],
          country_code: c.country_code,
          label: r.formatted_address,
          // ROOFTOP is the building; RANGE_INTERPOLATED is a spot on the right
          // block. GEOMETRIC_CENTER and APPROXIMATE are a street or an area.
          precise: ['ROOFTOP', 'RANGE_INTERPOLATED'].includes(r.geometry?.location_type)
            || (r.types || []).some((t) => GOOGLE_PRECISE.has(t)),
        });
      });
    },
  },

  locationiq: {
    async reverse(lat, lon) {
      const url = `https://us1.locationiq.com/v1/reverse?key=${API_KEY}&lat=${lat}&lon=${lon}&format=json&normalizecity=1`;
      const d = await getJSON(url);
      const a = d.address || {};
      return place(lat, lon, {
        city: firstOf(a.city, a.town, a.village, a.county),
        country_code: a.country_code,
        label: d.display_name,
      });
    },
    async search(q, limit) {
      const url = `https://us1.locationiq.com/v1/search?key=${API_KEY}&q=${encodeURIComponent(q)}&limit=${limit}&format=json&normalizecity=1&addressdetails=1`;
      const rows = await getJSON(url);
      return (Array.isArray(rows) ? rows : []).map((r) => {
        const a = r.address || {};
        return place(r.lat, r.lon, {
          city: firstOf(a.city, a.town, a.village, a.county, (r.display_name || '').split(',')[0]),
          country_code: a.country_code,
          label: r.display_name,
          precise: Boolean(a.house_number),
        });
      });
    },
  },
};

// Whether an external provider can actually be called. Nominatim counts as
// unusable in production: it answers 403 for traffic it cannot attribute, so
// treating it as available only produced errors.
function providerUsable() {
  const provider = providers[PROVIDER];
  if (!provider) return false;
  if (PROVIDER === 'nominatim') return process.env.NODE_ENV !== 'production';
  return Boolean(API_KEY);
}

function activeProvider() {
  if (!providerUsable()) throw new GeoError(LOCATION_UNAVAILABLE, 503);
  return providers[PROVIDER];
}

// "Jerusalem, IL" reads as Illinois to anyone in America, so outside the US
// the country is spelled out: "Jerusalem, Israel", "Gateshead, NSW, Australia".
const countryNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; } })();
function readableLabel(p) {
  if (p.country_code === 'US') return placeLabel(p);
  let country = p.country_code;
  try { country = countryNames?.of(p.country_code) || country; } catch { /* unknown code */ }
  return [p.city, p.region, country].filter(Boolean).join(', ');
}

// The curated list of communities, in the shape the rest of the app expects.
const fromPlace = (p) => ({
  latitude: p.latitude,
  longitude: p.longitude,
  city: p.city,
  // The state or province, so picking a city can fill the state field too.
  region: p.region || '',
  country_code: p.country_code,
  timezone: tzFor(p.latitude, p.longitude),
  label: readableLabel(p),
  source: 'klal',
  precise: false,
});

// A town from the bundled world list (./worldCities.js), in the same shape.
const fromTown = (t) => ({ ...fromPlace(t), source: 'world' });

// The curated communities first, then any other town in the world whose name
// starts with what was typed. Both answer without a key or a request.
async function knownPlaces(q, limit, { country = '', near = null } = {}) {
  let local = findPlaces(q, country ? 50 : limit).filter((p) => !country || p.country_code === country).map(fromPlace);
  // Nearest first among the curated ones too, names starting with what was
  // typed ahead of the rest.
  if (near) {
    const fq = String(q).trim().toLowerCase();
    const km = (p) => distanceKm(near.lat, near.lng, p.latitude, p.longitude);
    local = local.map((p, i) => ({ p, i })).sort((a, b) =>
      Number(b.p.city.toLowerCase().startsWith(fq)) - Number(a.p.city.toLowerCase().startsWith(fq)) || km(a.p) - km(b.p)).map(({ p }) => p);
  }
  local = local.slice(0, limit);
  if (local.length >= limit) return local;
  const towns = await findTowns(q, limit, { country, near });
  // "Lakewood CO" names its state, so that Lakewood beats the curated one in
  // New Jersey that merely shares the name. Where the named town is a curated
  // community anyway ("lakewood nj"), the curated entry keeps its place.
  const named = towns.filter((t) => t.qualified).map((t) =>
    local.find((p) => distanceKm(p.latitude, p.longitude, t.latitude, t.longitude) < 10) || fromTown(t));
  return dedupePlaces([...named, ...local, ...towns.map(fromTown)], limit);
}

// "1880 Ocean Ave, Brooklyn" — a house number then a word. Such a query must
// reach the provider even when the curated list already named the town.
const looksLikeAddress = (q) => /^\s*\d+[a-z]?(-\d+)?\s+[a-z]/i.test(q);

// ---- US street addresses without a key ---------------------------------------

// The US Census Bureau's geocoder: free, no key, no account, and it places a
// US street address on its block. It is what lets "4000 N 46th Ave,
// Hollywood FL" land on the building when no paid provider is configured, or
// when the configured one cannot place the address. US only: anywhere else it
// simply finds nothing, and the curated towns still answer. Set
// KC_CENSUS_GEOCODER=0 to turn it off.
const CENSUS_URL = process.env.KC_CENSUS_URL || 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const censusEnabled = () => process.env.KC_CENSUS_GEOCODER !== '0';

// The Census answers in capitals: "4000 N 46TH AVE" -> "4000 N 46th Ave".
const titleCase = (s) => String(s || '').toLowerCase()
  .replace(/\b([a-z])/g, (c) => c.toUpperCase())
  .replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (_, n, sfx) => n + sfx.toLowerCase())
  .replace(/\b(Ne|Nw|Se|Sw)\b/g, (d) => d.toUpperCase());

// "4000 N 46TH AVE, HOLLYWOOD, FL, 33021" -> "4000 N 46th Ave, Hollywood, FL 33021"
function censusLabel(matched) {
  const [street, city, state, zip] = String(matched || '').split(',').map((s) => s.trim());
  if (!state) return titleCase(matched);
  return `${titleCase(street)}, ${titleCase(city)}, ${state.toUpperCase()}${zip ? ` ${zip}` : ''}`;
}

async function censusSearch(q, limit) {
  const key = `census:${q.toLowerCase()}`;
  const hit = await geoCache.get(key);
  if (hit) return hit;
  const url = `${CENSUS_URL}?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`;
  const d = await getJSON(url);
  const matches = d?.result?.addressMatches || [];
  const rows = matches.slice(0, limit).filter((m) => Number.isFinite(Number(m?.coordinates?.y)) && Number.isFinite(Number(m?.coordinates?.x))).map((m) => {
    const city = m.addressComponents?.city || '';
    return place(m.coordinates.y, m.coordinates.x, {
      city: titleCase(city),
      country_code: 'US',
      label: censusLabel(m.matchedAddress),
      precise: true,
    });
  });
  await geoCache.set(key, rows, SEARCH_TTL);
  return rows;
}

// ---- public API -------------------------------------------------------------

const isFiniteNum = (n) => Number.isFinite(Number(n));

export async function reverseGeocode(lat, lon, { offline = false } = {}) {
  if (!isFiniteNum(lat) || !isFiniteNum(lon)) throw new GeoError('Invalid coordinates.', 400);
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new GeoError('Coordinates out of range.', 400);
  }

  // A community we already know is a better answer than a provider's, and it
  // needs no key: "Lakewood, NJ" rather than whichever township the point
  // technically falls in.
  const known = nearestPlace(latitude, longitude);
  if (known) return { ...fromPlace(known), latitude, longitude, timezone: tzFor(latitude, longitude) };
  if (!providerUsable() || offline) {
    // Still a name for the point when a town in the world list is close.
    const town = await nearestTown(latitude, longitude);
    if (town) return { ...fromTown(town), latitude, longitude, timezone: tzFor(latitude, longitude) };
    // No provider and nowhere we recognise — but the time zone comes from the
    // coordinates offline, and that is the part zmanim need. An unnamed
    // location with the right zone beats an error that leaves the app with no
    // candle-lighting time at all.
    const timezone = tzFor(latitude, longitude);
    if (timezone) return { latitude, longitude, city: '', country_code: '', timezone, label: '', source: 'coordinates' };
    throw new GeoError(LOCATION_UNAVAILABLE, 503);
  }

  // ~1km precision: enough to name a neighbourhood, and it collapses the many
  // near-identical lookups a moving device produces into one cache entry. It
  // also means we never persist a user's exact position as a cache key.
  const key = `rev:${PROVIDER}:${latitude.toFixed(2)},${longitude.toFixed(2)}`;
  const hit = await geoCache.get(key);
  // Coordinates are the caller's own; only the place name is cached.
  if (hit) return { ...hit, latitude, longitude, timezone: tzFor(latitude, longitude) };

  let result;
  try {
    result = await call(() => activeProvider().reverse(latitude, longitude));
  } catch (err) {
    // A provider that errors must not cost the caller their time zone. The
    // no-provider branch above already settled this: an unnamed location with
    // the right zone beats an error that leaves the app with no candle-lighting
    // time at all. A provider that is configured but failing — a quota, a 429,
    // an outage — is the same situation, and was not handled.
    const town = await nearestTown(latitude, longitude);
    if (town) return { ...fromTown(town), latitude, longitude, timezone: tzFor(latitude, longitude) };
    const timezone = tzFor(latitude, longitude);
    if (timezone) return { latitude, longitude, city: '', country_code: '', timezone, label: '', source: 'coordinates' };
    throw err;
  }
  await geoCache.set(key, { city: result.city, country_code: result.country_code, label: result.label }, REVERSE_TTL);
  return result;
}

// `offline` answers only from the lists shipped with the app: what a signed-out
// visitor gets, since nobody can spend a provider's quota that way.
// `country` (a code) keeps every answer in that country; `near` ({ lat, lng })
// puts the closest known places first.
export async function searchPlaces(query, limit = 8, { offline = false, country = '', near = null } = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) throw new GeoError('Enter at least two characters.', 400);
  const capped = Math.min(Math.max(Number(limit) || 8, 1), 10);

  // The communities Klal serves answer first, then every other town in the
  // world, instantly and without a key. A provider only sees what is left — a
  // street address, a village too small for the list — and if there is no
  // usable provider, the known places are still an answer rather than a 503.
  const cc = /^[A-Z]{2}$/.test(String(country || '').toUpperCase()) ? String(country).toUpperCase() : '';
  const local = await knownPlaces(q, capped, { country: cc, near });
  const address = looksLikeAddress(q);
  // Nothing found here is an answer too: the whole world list was asked, so
  // "not on our list" is true, where "cannot reach the lookup" was not.
  if (offline || (!address && (local.length >= capped || !providerUsable()))) return local;

  let results = [];
  let failure = null;
  if (providerUsable()) {
    // v2: results now carry `precise`; older cached rows do not.
    const key = `search2:${PROVIDER}:${capped}:${q.toLowerCase()}`;
    const hit = await geoCache.get(key);
    if (hit) results = hit;
    else {
      try {
        // An address search asks for the full list: the curated towns must not
        // crowd out the one result that is the building itself.
        results = await call(() => activeProvider().search(q, address ? capped : capped - local.length));
        await geoCache.set(key, results, SEARCH_TTL);
      } catch (err) {
        // The curated communities were already an answer, fetched above. A
        // provider that errors must not take them down with it — that is how a
        // search for "Lakewood" answered 503 while the list knew exactly where
        // Lakewood is.
        failure = err;
      }
    }
  }

  // A street address the configured provider could not place — or that no
  // provider was asked about, because none is configured — goes to the
  // Census geocoder. Without this, every address search on a site with no
  // key ended at the middle of town.
  if (address && censusEnabled() && !results.some((r) => r.precise)) {
    try {
      results = [...(await censusSearch(q, capped)), ...results];
    } catch {
      // Same as a failing provider: the towns still answer.
    }
  }

  if (!results.length) {
    // Only a street address is worth reporting a failing provider for; a town
    // name was already looked up in the world list.
    if (local.length || !address || !failure) return local;
    throw failure;
  }
  return mergePlaces(local, cc ? results.filter((r) => r.country_code === cc) : results, capped);
}

// Exact addresses first, then the curated towns, then the provider's other
// answers. Exact addresses go first because a search for "1880 Ocean Ave,
// Brooklyn" also names Brooklyn, and the town used to win and hide the
// building: the pin landed in the middle of Brooklyn.
function mergePlaces(local, results, limit) {
  const precise = results.filter((r) => r.precise);
  const rough = results.filter((r) => !r.precise);
  return dedupePlaces([...precise, ...local, ...rough], limit);
}

// A provider will often return the same city the curated list already gave.
// Coordinates within ~10km of one already listed are the same town. That rule
// is only for towns: two buildings a block apart are different places, and a
// building is never a duplicate of the town it is in.
function dedupePlaces(rows, limit) {
  const out = [];
  for (const r of rows) {
    const same = (k) => distanceKm(k.latitude, k.longitude, r.latitude, r.longitude) < (r.precise && k.precise ? 0.02 : 10);
    if (out.some((k) => (r.precise ? k.precise : !k.precise) && same(k))) continue;
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

// ---- pinning a listing from its address -------------------------------------

// The coordinates to store for a listing saved without any, from what it does
// have: a street address, or just its town. Where the business is only known
// by town, the town's centre is the pin — that is what the directory map and
// "nearest" already work from when a city is picked in the form. A street
// address gets the building itself when a provider can place it, and the town
// otherwise, never a provider's guess at some other town.
//
// Returns {latitude, longitude, pin_precise} or null; never throws.
// pin_precise says whether the pin is the building itself or the middle of
// its town, so a page can tell a rooftop from a guess at the town. Stored
// without it, the two were indistinguishable next to a street address.
//
// The lookup is bounded so a slow or blocked provider cannot hold up the save
// it runs inside: two seconds is long enough for a provider that is answering
// and short enough that a save does not feel broken when one is not.
const PIN_TIMEOUT_MS = 2000;

// A value the map can draw. null, undefined and '' are all "no coordinate";
// Number('') and Number(null) are both 0, so a plain finiteness check read an
// empty string as a pin on the equator and never geocoded the row.
const hasCoord = (v) => v !== null && v !== undefined && String(v).trim() !== '' && Number.isFinite(Number(v));

// Curated towns the list knows by a name that also belongs to a sizable town
// in another state or country. "Jackson" on its own is Jackson, NJ to this
// directory and Jackson, MS to the rest of the world; without a state on the
// row there is no way to tell, so the curated pin is withheld for these and
// the row stays unpinned (or takes a provider's answer) rather than land in
// the wrong state. The bar is a city of real size elsewhere, not a village
// that happens to share the name: Lakewood is here because Colorado, Ohio
// and California each have one bigger than a town, Monsey is not because
// nowhere else does, and Elizabeth is not because the other Elizabeths are
// too small for a listing to plausibly mean them.
const AMBIGUOUS_TOWN_NAMES = new Set([
  'jackson', 'hollywood', 'paris', 'manchester', 'london', 'columbus', 'portland', 'melbourne', 'vienna',
  'lakewood', 'williamsburg', 'manhattan',
]);

export async function pinForListing(row) {
  if (!row || (hasCoord(row.latitude) && hasCoord(row.longitude))) return null;
  const address = String(row.address || '').trim();
  const city = String(row.city || '').trim();
  const state = String(row.state || '').trim().toUpperCase();
  if (!address && !city) return null;
  const q = [address, city, state].filter(Boolean).join(', ');
  let timer;
  try {
    const results = await Promise.race([
      searchPlaces(q, address ? 5 : 1),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new GeoError(LOCATION_UNAVAILABLE, 504)), PIN_TIMEOUT_MS); }),
    ]);
    // A curated town is only an answer when it is the town the row means.
    // findPlaces matches "Paris, TX" to the curated Paris by word containment
    // and the pin used to be accepted on the city name alone, so a Texas
    // listing was drawn in France. With a state on the row the town's state
    // has to agree; without one, a name shared across states is no answer.
    const rightPlace = (r) => {
      if (r.source !== 'klal') return true;
      if (state) return String(r.region || '').toUpperCase() === state;
      return !AMBIGUOUS_TOWN_NAMES.has(String(r.city || '').toLowerCase());
    };
    const usable = results.filter(rightPlace);
    const sameTown = (r) => city && String(r.city || '').toLowerCase() === city.toLowerCase();
    const hit = (address && usable.find((r) => r.precise)) || usable.find(sameTown) || (!address ? usable[0] : null);
    if (!hit || !hasCoord(hit.latitude) || !hasCoord(hit.longitude)) return null;
    return { latitude: Number(hit.latitude), longitude: Number(hit.longitude), pin_precise: Boolean(hit.precise) };
  } catch {
    // A listing without a pin is still a listing; the next edit tries again.
    return null;
  } finally {
    // The losing timer otherwise keeps the process busy for the full bound
    // after every save the curated list answered in a millisecond.
    clearTimeout(timer);
  }
}

// ---- IP fallback ------------------------------------------------------------

// Used only when the browser's geolocation is unavailable or denied. Runs
// server-side so the user's IP is not handed to a third party by their own
// browser, and so results are cached per network rather than per page load.
const IP_ENDPOINT = process.env.KC_IPGEO_URL || 'https://ipapi.co/{ip}/json/';

export async function geolocateIp(ip) {
  const clean = String(ip || '').replace(/^::ffff:/, '');
  // Loopback and private ranges have no public location; say so rather than
  // returning whatever the provider guesses for our own server.
  if (!clean || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd)/i.test(clean)) {
    return null;
  }

  const key = `ip:${clean}`;
  const hit = await geoCache.get(key);
  if (hit) return hit;

  const d = await getJSON(IP_ENDPOINT.replace('{ip}', encodeURIComponent(clean)));
  if (d?.latitude == null || d?.longitude == null) return null;
  const result = place(d.latitude, d.longitude, {
    city: d.city,
    country_code: d.country_code || d.country,
    label: d.city,
  });
  return await geoCache.set(key, result, IP_TTL);
}

export { GeoError, PROVIDER };
