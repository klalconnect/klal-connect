// Exercises each geocoder adapter against a recorded response shape, so the
// four we cannot hit live (no API key) are still known to parse correctly.
const FIXTURES = {
  mapbox: {
    reverse: { features: [{ text: 'Lakewood', place_name: 'Lakewood, New Jersey, United States',
      context: [{ id: 'region.1', short_code: 'US-NJ' }, { id: 'country.2', short_code: 'us' }] }] },
    search: { features: [{ text: 'Lakewood', place_name: 'Lakewood, New Jersey, United States',
      center: [-74.2179, 40.0959], context: [{ id: 'country.2', short_code: 'us' }] }] },
  },
  geoapify: {
    reverse: { results: [{ city: 'Lakewood', county: 'Ocean County', country_code: 'us', formatted: 'Lakewood, NJ, USA' }] },
    search: { results: [{ city: 'Lakewood', county: 'Ocean County', country_code: 'us',
      formatted: 'Lakewood, NJ, USA', lat: 40.0959, lon: -74.2179 }] },
  },
  locationiq: {
    reverse: { address: { city: 'Lakewood', country_code: 'us' }, display_name: 'Lakewood, Ocean County, NJ, USA' },
    search: [{ lat: '40.0959', lon: '-74.2179', display_name: 'Lakewood, Ocean County, NJ, USA',
      address: { city: 'Lakewood', country_code: 'us' } }],
  },
  google: {
    reverse: { status: 'OK', results: [{ formatted_address: 'Lakewood, NJ, USA',
      address_components: [
        { long_name: 'Lakewood', short_name: 'Lakewood', types: ['locality', 'political'] },
        { long_name: 'Ocean County', short_name: 'Ocean County', types: ['administrative_area_level_2', 'political'] },
        { long_name: 'United States', short_name: 'US', types: ['country', 'political'] },
      ] }] },
    search: { status: 'OK', results: [{ formatted_address: 'Lakewood, NJ, USA',
      geometry: { location: { lat: 40.0959, lng: -74.2179 } },
      address_components: [
        { long_name: 'Lakewood', short_name: 'Lakewood', types: ['locality', 'political'] },
        { long_name: 'United States', short_name: 'US', types: ['country', 'political'] },
      ] }] },
  },
  nominatim: {
    reverse: { address: { town: 'Lakewood', country_code: 'us' }, display_name: 'Lakewood, Ocean County, NJ, USA' },
    search: [{ lat: '40.0959', lon: '-74.2179', display_name: 'Lakewood, Ocean County, NJ, USA',
      address: { city: 'Lakewood', country_code: 'us' } }],
  },
};

import { pathToFileURL } from 'node:url';
import path from 'node:path';
const GEO_URL = pathToFileURL(path.join(import.meta.dirname, 'geocode.js')).href;

let mode = 'reverse';
let provider = 'nominatim';
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => FIXTURES[provider][mode] });

let failures = 0;
const check = (label, cond, got) => {
  if (!cond) { failures++; console.log(`  FAIL ${label} -> ${JSON.stringify(got)}`); }
  else console.log(`  ok   ${label} -> ${JSON.stringify(got)}`);
};

for (const name of Object.keys(FIXTURES)) {
  provider = name;
  process.env.KC_GEOCODER = name;
  process.env.KC_GEOCODER_KEY = 'test-key';
  process.env.KC_GEOCODER_MIN_GAP_MS = '0';
  // Fresh module per provider: PROVIDER is read at import time.
  const mod = await import(`${GEO_URL}?v=${name}`);

  console.log(`\n${name}:`);
  mode = 'reverse';
  const rev = await mod.reverseGeocode(40.0959 + Math.random() * 0.0001, -74.2179);
  check('reverse city', rev.city === 'Lakewood', rev.city);
  check('reverse cc', rev.country_code === 'US', rev.country_code);
  check('reverse tz', rev.timezone === 'America/New_York', rev.timezone);

  mode = 'search';
  // A query the curated list in places.js does NOT hold, so this exercises
  // the provider adapter rather than the local answer. (The list is checked
  // separately, below.)
  const res = await mod.searchPlaces(`Zzyzx ${name}`, 3);
  const first = res[0] || {};
  check('search count', res.length === 1, res.length);
  check('search city', first.city === 'Lakewood', first.city);
  check('search cc', first.country_code === 'US', first.country_code);
  check('search lat', Math.abs(first.latitude - 40.0959) < 0.001, first.latitude);
  check('search lon', Math.abs(first.longitude + 74.2179) < 0.001, first.longitude);
  check('search tz', first.timezone === 'America/New_York', first.timezone);
  check('search label', typeof first.label === 'string' && first.label.length > 0, first.label);
}

// A street address in a town the curated list knows. The list names the town
// (Brooklyn) and Google finds the building; the building must come first and
// must survive, or the pin lands in the middle of Brooklyn.
console.log('\naddress in a known town (google):');
process.env.KC_GEOCODER = 'google';
process.env.KC_GEOCODER_KEY = 'test-key';
process.env.KC_GEOCODER_MIN_GAP_MS = '0';
let asked = '';
globalThis.fetch = async (url) => {
  asked = String(url);
  return { ok: true, status: 200, json: async () => ({ status: 'OK', results: [{
    formatted_address: '1880 Ocean Ave, Brooklyn, NY 11230, USA',
    types: ['street_address'],
    geometry: { location: { lat: 40.6189, lng: -73.9580 }, location_type: 'ROOFTOP' },
    address_components: [
      { long_name: 'Brooklyn', short_name: 'Brooklyn', types: ['sublocality_level_1', 'sublocality', 'political'] },
      { long_name: 'New York', short_name: 'New York', types: ['locality', 'political'] },
      { long_name: 'United States', short_name: 'US', types: ['country', 'political'] },
    ] }] }) };
};
const addr = await import(`${GEO_URL}?v=address`);
const pins = await addr.searchPlaces('1880 Ocean Ave, Brooklyn NY 11230', 8);
check('full address sent to google', asked.includes(encodeURIComponent('1880 Ocean Ave, Brooklyn NY 11230')), asked.split('?')[1]?.split('&')[0]);
check('the building is first', pins[0]?.precise && Math.abs(pins[0].latitude - 40.6189) < 0.0001, pins[0] && `${pins[0].label} ${pins[0].latitude},${pins[0].longitude}`);
check('the town is still offered', pins.some((p) => !p.precise && p.city === 'Brooklyn'), pins.map((p) => p.label));

// No provider key at all — the live site's situation. A street address must
// still land on the building, through the Census geocoder, and never by
// asking a provider that is not configured.
console.log('\nstreet address with no provider key (census):');
delete process.env.KC_GEOCODER;
delete process.env.KC_GEOCODER_KEY;
process.env.NODE_ENV = 'production';
const censusAsked = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  censusAsked.push(u);
  if (!u.startsWith('https://geocoding.geo.census.gov/')) throw new Error(`unexpected call to ${u}`);
  return { ok: true, status: 200, json: async () => ({ result: { addressMatches: [{
    matchedAddress: '4000 N 46TH AVE, HOLLYWOOD, FL, 33021',
    coordinates: { x: -80.1823, y: 26.0459 },
    addressComponents: { city: 'HOLLYWOOD', state: 'FL', zip: '33021' },
  }] } }) };
};
const census = await import(`${GEO_URL}?v=census`);
const hw = await census.searchPlaces('4000 N 46th Ave, Hollywood FL', 8);
check('census asked with the full address', censusAsked.some((u) => u.includes(encodeURIComponent('4000 N 46th Ave, Hollywood FL'))), censusAsked.length);
check('the building is first', hw[0]?.precise && Math.abs(hw[0].latitude - 26.0459) < 0.0001 && Math.abs(hw[0].longitude + 80.1823) < 0.0001, hw[0]);
check('readable label', hw[0]?.label === '4000 N 46th Ave, Hollywood, FL 33021', hw[0]?.label);
check('city and country', hw[0]?.city === 'Hollywood' && hw[0]?.country_code === 'US', `${hw[0]?.city} / ${hw[0]?.country_code}`);
const pinned = await census.pinForListing({ address: '4000 N 46th Ave', city: 'Hollywood', state: 'FL' });
check('a saved listing gets the building as its pin', pinned?.pin_precise === true && Math.abs(pinned.latitude - 26.0459) < 0.0001, pinned);
censusAsked.length = 0;
await census.searchPlaces('Hollywood', 4).catch(() => []);
check('a town search does not reach the census', censusAsked.length === 0, censusAsked.length);

// A configured provider that can only place the street, not the building:
// the Census gets a turn, and its exact answer comes first.
console.log('\nprovider without an exact match falls back to census:');
process.env.KC_GEOCODER = 'google';
process.env.KC_GEOCODER_KEY = 'test-key';
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith('https://geocoding.geo.census.gov/')) {
    return { ok: true, status: 200, json: async () => ({ result: { addressMatches: [{
      matchedAddress: '4000 N 46TH AVE, HOLLYWOOD, FL, 33021', coordinates: { x: -80.1823, y: 26.0459 },
      addressComponents: { city: 'HOLLYWOOD' } }] } }) };
  }
  return { ok: true, status: 200, json: async () => ({ status: 'OK', results: [{
    formatted_address: 'Hollywood, FL, USA', types: ['locality', 'political'],
    geometry: { location: { lat: 26.0112, lng: -80.1495 }, location_type: 'APPROXIMATE' },
    address_components: [{ long_name: 'Hollywood', short_name: 'Hollywood', types: ['locality', 'political'] },
      { long_name: 'United States', short_name: 'US', types: ['country', 'political'] }] }] }) };
};
const mixed = await import(`${GEO_URL}?v=mixed`);
const mx = await mixed.searchPlaces('4000 N 46th Ave, Hollywood FL', 8);
check('census building comes first', mx[0]?.precise && mx[0].label.startsWith('4000 N 46th Ave'), mx.map((r) => r.label));

// The curated list answers a known community first, with no provider call at
// all — that is what keeps city lookup, zmanim and map pins working with no
// key configured.
console.log('\ncurated places (no provider):');
delete process.env.KC_GEOCODER;
delete process.env.KC_GEOCODER_KEY;
process.env.NODE_ENV = 'production';
globalThis.fetch = async () => { throw new Error('the curated list must not call a provider'); };
const local = await import(`${GEO_URL}?v=local`);
for (const [query, city, tz] of [
  ['Jerusalem', 'Jerusalem', 'Asia/Jerusalem'],
  ['rbs', 'Beit Shemesh', 'Asia/Jerusalem'],
  ['boro park', 'Boro Park', 'America/New_York'],
  ['7200 Palmetto Circle N Boca Raton, FL 33433', 'Boca Raton', 'America/New_York'],
]) {
  const [hit] = await local.searchPlaces(query, 2);
  check(`search ${JSON.stringify(query)}`, hit && hit.city === city && hit.timezone === tz, hit && `${hit.city} / ${hit.timezone}`);
}
const known = await local.reverseGeocode(31.7683, 35.2137);
check('reverse names a known community', known.city === 'Jerusalem' && known.country_code === 'IL', `${known.city} / ${known.country_code}`);
const unknown = await local.reverseGeocode(42.88, -78.87);
// Not a curated community, but the bundled world list names it.
check('reverse elsewhere names the town from the world list', unknown.timezone === 'America/New_York' && unknown.city === 'Buffalo', `${JSON.stringify(unknown.city)} / ${unknown.timezone}`);
const sea = await local.reverseGeocode(30, -40);
check('reverse in the middle of nowhere still gives a time zone', sea.city === '' && !!sea.timezone, `${JSON.stringify(sea.city)} / ${sea.timezone}`);
// Towns no curated list has, which the world list must find with no key.
for (const [query, city, region, tz] of [
  ['deerf', 'Deerfield Beach', 'FL', 'America/New_York'],
  ['Boise', 'Boise', 'ID', 'America/Boise'],
  ['Boise, ID', 'Boise', 'ID', 'America/Boise'],
  ['lakewood co', 'Lakewood', 'CO', 'America/Denver'],
]) {
  const [hit] = await local.searchPlaces(query, 6);
  check(`world list ${JSON.stringify(query)}`, hit && hit.city === city && hit.region === region && hit.timezone === tz, hit && `${hit.label} / ${hit.timezone}`);
}
const [haifa] = await local.searchPlaces('Haifa', 2);
check('a place outside the US spells out its country', haifa?.label === 'Haifa, Israel', haifa?.label);
const lw = await local.searchPlaces('Lakewood', 6);
check('the curated Lakewood still comes first', lw[0]?.region === 'NJ' && lw.length > 1, lw.map((r) => r.label));

// A provider that is configured and then fails. This is the case that bit: the
// curated list had already answered above, and a single provider error threw
// that answer away — a search for "Lakewood" came back 503 while the list knew
// exactly where Lakewood is. It only appears once a key is set, which is the
// moment someone adds one.
console.log('\nconfigured provider, upstream failing:');
process.env.KC_GEOCODER = 'google';
process.env.KC_GEOCODER_KEY = 'test-key';
process.env.KC_GEOCODER_MIN_GAP_MS = '0';
process.env.NODE_ENV = 'production';
globalThis.fetch = async () => { throw new Error('upstream down'); };
const failing = await import(`${GEO_URL}?v=failing`);

const [stillKnown] = await failing.searchPlaces('Lakewood', 4);
check('a known community still answers', stillKnown && stillKnown.city === 'Lakewood', stillKnown && stillKnown.city);

// Rural Nebraska: nowhere the curated list knows, so this reaches the provider.
const farPoint = await failing.reverseGeocode(41.0, -101.0).catch((err) => ({ error: err.message }));
check('an unknown point still yields a time zone', !!farPoint.timezone, farPoint.timezone || farPoint.error);

// A town name nobody knows is an empty answer (shown as "not on our list"),
// never an invented place.
const none = await failing.searchPlaces('Zzqqxlandiaville', 4).catch((err) => ({ error: err.message }));
check('a query nothing knows finds nothing rather than inventing one', Array.isArray(none) && none.length === 0, none);
const deerfield = await failing.searchPlaces('Deerfield Beach', 4);
check('a town in the world list answers while the provider is down', deerfield[0]?.city === 'Deerfield Beach', deerfield.map((r) => r.label));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall provider adapters parse correctly, and the curated list answers without one');
process.exit(failures ? 1 : 0);
