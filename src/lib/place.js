// Where a listing helps, matched against where a person is.
//
// A plain substring test over the location fields got the most important
// question in this product wrong. Four of the organisations listed here serve
// the entire country — Chai Lifeline, OHEL, Bonei Olam and Relief Resources
// all file their service area as "Nationwide" — and that text contains
// "nationwide", not "Boca Raton". So a Boca Raton visitor searching for a
// therapist was shown nothing local and told these four were available in
// "another community". They are available to them, today, by phone.
//
// "Who can help me with this, in this community?" is the question the whole
// directory exists to answer, so it is answered in one place and shared by the
// homepage and the search rather than written twice and allowed to drift.

import { countryOf, countryName, countriesStarting, servesWorldwide, US } from './countries.js';

// Service areas that mean "anywhere", not a place. Matched on word boundaries
// so a city named in passing cannot trip it.
const EVERYWHERE = /\b(nationwide|nation-?wide|national(?:ly)?|worldwide|international(?:ly)?|global(?:ly)?|anywhere|everywhere|remote(?:ly)?|virtual(?:ly)?|telehealth|by phone|all communities|any community|usa|united states)\b/i;

/** Does this listing serve people anywhere, rather than one place? */
export function servesEverywhere(provider) {
  const areas = provider?.service_areas;
  if (!Array.isArray(areas)) return false;
  return areas.some((area) => EVERYWHERE.test(String(area || '')));
}

// Place matching is by city, state or ZIP, never by a fragment of text: a
// substring test let "FL" match Flushing, NY, and "LA" match Atlanta.
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const STATES = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut',
  de: 'delaware', dc: 'district of columbia', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois',
  in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland',
  ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana',
  ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico', ny: 'new york',
  nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania',
  ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah',
  vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming',
};
const STATE_BY_NAME = Object.fromEntries(Object.entries(STATES).map(([code, name]) => [name, code]));

// What people call a place that is not one city. "LA" is Los Angeles here,
// never Louisiana (spell out "Louisiana" for the state), and NYC is the five
// boroughs and the neighbourhoods listings name instead of a borough.
const QUEENS = ['queens', 'flushing', 'forest hills', 'rego park', 'kew gardens', 'kew gardens hills', 'fresh meadows',
  'jamaica', 'jamaica estates', 'far rockaway', 'middle village', 'bayside', 'hillcrest', 'briarwood', 'jackson heights',
  'long island city', 'astoria', 'little neck', 'oakland gardens', 'holliswood', 'richmond hill', 'whitestone', 'college point'];
const NYC = ['new york', 'new york city', 'manhattan', 'brooklyn', 'bronx', 'riverdale', 'staten island', ...QUEENS];
const LA = ['los angeles', 'valley village', 'sherman oaks', 'encino', 'tarzana', 'north hollywood', 'n hollywood',
  'beverly hills', 'reseda', 'woodland hills', 'van nuys', 'studio city', 'west hollywood', 'northridge',
  'canoga park', 'west hills', 'pico robertson', 'hancock park', 'santa monica', 'culver city', 'glendale'];
const FIVE_TOWNS = ['lawrence', 'cedarhurst', 'woodmere', 'hewlett', 'inwood', 'far rockaway', 'woodsburgh', 'hewlett bay park'];
const ALIASES = {
  la: { state: 'ca', cities: LA }, 'l a': { state: 'ca', cities: LA }, 'los angeles': { state: 'ca', cities: LA },
  nyc: { state: 'ny', cities: NYC }, 'new york city': { state: 'ny', cities: NYC },
  queens: { state: 'ny', cities: QUEENS },
  'five towns': { state: 'ny', cities: FIVE_TOWNS }, '5 towns': { state: 'ny', cities: FIVE_TOWNS },
};

/** A US state's full name, "Florida" for "FL" or "florida", or ''. */
export function stateName(text) {
  const t = norm(text);
  const name = STATES[t] || (STATE_BY_NAME[t] ? t : '');
  return name.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(' Of ', ' of ');
}

/**
 * Is this text a place alias or a state? Used to spot a place typed into the
 * keyword box. A two-letter code only counts when typed in capitals ("FL",
 * "LA"), so "in", "or", "me" and the "la" of "La Vela" stay words.
 */
export function isPlaceWord(text, { upper = false } = {}) {
  const t = norm(text);
  if (t.length <= 2) return upper && Boolean(ALIASES[t] || STATES[t]);
  return Boolean(ALIASES[t] || STATE_BY_NAME[t]);
}

/**
 * A test for "does this listing serve `where`?", built once per search.
 *
 * `where` can be a ZIP, a state ("FL", "Florida"), a city with or without its
 * state ("Boca Raton", "Brooklyn, NY"), or an alias (NYC, LA, Five Towns).
 * A city is matched by whole words ("Boca" is Boca and Boca Raton); only when
 * no listing has such a city (while someone is still typing "Bo") does the
 * start of a city name count.
 * Listings that serve everywhere match every place, unless `everywhere` is
 * false: then only listings actually in the place match. Returns null for no place.
 */
export function placeMatcher(where, providers = null, { everywhere = true } = {}) {
  const text = norm(where);
  if (!text) return null;
  // A listing that serves its whole country ("Nationwide") matches places in
  // that country only: Chai Lifeline is not in Jerusalem. One that serves the
  // whole world, or names no country, matches every place.
  const everywhereOr = (test, countries = null) => (!everywhere ? test : (p) => test(p) || servesWorldwide(p) || (servesEverywhere(p)
    && (!countries || !countryOf(p) || countries.has(countryOf(p)))));
  const inUS = new Set([US]);
  // A US state means a US listing: "WA" is not Perth, Western Australia.
  const usOk = (p) => !countryOf(p) || countryOf(p) === US;
  const cityOf = (p) => norm(p?.city);
  const areasOf = (p) => (p?.service_areas || []).map(norm);
  const stateOf = (p) => norm(p?.state);
  const inCities = (cities) => {
    const set = new Set(cities);
    return (p) => set.has(cityOf(p)) || set.has(norm(p?.neighborhood)) || areasOf(p).some((a) => set.has(a));
  };

  if (/^\d{3,5}$/.test(text)) return everywhereOr((p) => String(p?.zip || '').startsWith(text) && usOk(p), inUS);
  const alias = ALIASES[text];
  if (alias) {
    const inAlias = inCities(alias.cities);
    return everywhereOr((p) => inAlias(p) && usOk(p) && (!stateOf(p) || stateOf(p) === alias.state), inUS);
  }
  if (STATES[text] || STATE_BY_NAME[text]) {
    const code = STATES[text] ? text : STATE_BY_NAME[text];
    return everywhereOr((p) => stateOf(p) === code && usOk(p), inUS);
  }
  // A country: "Israel", "France", "England".
  const country = text.length > 2 || text === 'uk' ? countryName(text) : '';
  if (country) return everywhereOr((p) => countryOf(p) === country, new Set([country]));

  // "Brooklyn, NY", "Brooklyn NY" or "Boca Raton Florida"
  let city = text, state = '';
  const words = text.split(' ');
  const last = words[words.length - 1], lastTwo = words.slice(-2).join(' ');
  if (words.length > 2 && STATE_BY_NAME[lastTwo]) { state = STATE_BY_NAME[lastTwo]; city = words.slice(0, -2).join(' '); }
  else if (words.length > 1 && (STATES[last] || STATE_BY_NAME[last])) { state = STATES[last] ? last : STATE_BY_NAME[last]; city = words.slice(0, -1).join(' '); }
  const stateOk = (p) => !state || (stateOf(p) === state && usOk(p));
  if (ALIASES[city]) {
    const inAlias = inCities(ALIASES[city].cities);
    return everywhereOr((p) => inAlias(p) && stateOk(p), inUS);
  }

  // "Boca" is Boca and Boca Raton; "Miami" is Miami and Miami Beach.
  const named = (name) => name === city || name.startsWith(`${city} `);
  const exact = (p) => named(cityOf(p)) || named(norm(p?.neighborhood)) || areasOf(p).some(named);
  // The countries this city is in, going by the listings there.
  const countriesOf = (test) => (providers ? new Set(providers.filter(test).map(countryOf).filter(Boolean)) : null);
  if (!providers || providers.some(exact)) {
    const test = (p) => exact(p) && stateOk(p);
    return everywhereOr(test, countriesOf(test));
  }
  // Still typing: the start of a city, state or country name, at a word
  // boundary, so "Bah" already finds the Bahamas and "Flo" Florida.
  const starts = (name) => name.startsWith(city) || name.includes(` ${city}`);
  const countries = state ? new Set() : countriesStarting(city);
  const states = state || city.length < 3 ? new Set()
    : new Set(Object.entries(STATES).filter(([, name]) => starts(name)).flat());
  const test = (p) => ((starts(cityOf(p)) || areasOf(p).some(starts)) && stateOk(p))
    || countries.has(countryOf(p)) || (states.has(stateOf(p)) && usOk(p));
  return everywhereOr(test, countriesOf(test));
}

/**
 * Does this listing serve `where`?
 * An empty `where` is no constraint, and a listing that serves everywhere
 * serves every `where`. For many listings, build a placeMatcher once instead.
 */
export function servesPlace(provider, where) {
  const test = placeMatcher(where);
  return !test || test(provider);
}

/**
 * The communities that actually have something listed, most-listed first.
 * Derived from the data rather than hardcoded, so the list of places we can
 * honestly claim to serve grows as listings do — and a city never appears in
 * a picker with nothing behind it.
 *
 * Listings that serve everywhere name no community, so they are skipped here:
 * they will match whichever community is chosen anyway.
 */
export function communitiesFrom(providers = []) {
  const counts = new Map();
  for (const provider of providers) {
    if (servesEverywhere(provider)) continue;
    const city = String(provider?.city || '').trim();
    if (city) counts.set(city, (counts.get(city) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([city, count]) => ({ city, count }));
}
