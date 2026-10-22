import { categoryLabel } from './categories.js';
import { aliasGroup, aliasPhrases, keywordSuggestions, placeSuggestions } from './searchTerms.js';
import { placeMatcher, isPlaceWord, stateName } from './place.js';
import { countryName, countryOf, countryMatcher, countriesFrom, countriesStarting, inCountry, US } from './countries.js';

// Directory search: what someone types, matched the way they meant it.
//
// Plain substring search failed people in four ways. A plural found nothing
// ("factories" against "Factory"). A typo found nothing ("bakrey"). Two words
// were treated as one phrase, so "wholesale food" found nothing either. And a
// place typed with the search ("bakery Boca Raton") was ignored, so bakeries
// everywhere came back. This file handles all four in one place, so Home,
// Resources and Browse give the same answer.

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'for', 'in', 'near', 'at', 'on', 'to', 'with', 'by', 'my',
  'me', 'best', 'good', 'local', 'around', 'find', 'looking', 'need', 'any', 'some', 'place', 'places', 'shop', 'store']);

/** Lowercase words, without accents or punctuation. "Lenny's" is "lennys". */
export function words(text) {
  return String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '').replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(Boolean);
}

/** The singular of a word, near enough: factories → factory, bakeries → bakery, butchers → butcher. */
export function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

// Two typing mistakes apart at most: a missing, extra, changed or swapped letter.
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}
const allowedTypos = (w) => (w.length >= 8 ? 2 : w.length >= 4 ? 1 : 0);

// Where a word is found decides how directly a listing answers it. The broad
// category ("Food & Catering") counts least: "caterer" should open on the
// caterers, not on every restaurant filed under Food & Catering.
const FIELDS = [
  // What a listing is filed as beats a word in its name: a search for caterer
  // opens on the caterers before "Friendship Cafe & Catering", a restaurant.
  ['name', 5, (p) => p?.name],
  ['type', 6, (p) => [p?.subcategory, categoryLabel(p?.subcategory)].join(' ')],
  ['summary', 3, (p) => [p?.tagline, p?.short_description].join(' ')],
  // Only the main word of a two-part category: every restaurant is filed under
  // Food & Catering, and that alone does not make it a caterer.
  ['category', 1, (p) => [p?.category, categoryLabel(p?.category)].map((c) => String(c || '').split('&')[0]).join(' ')],
  ['more', 1, (p) => [p?.description, (p?.service_areas || []).join(' ')].join(' ')],
];

/** Each listing's words, stemmed, per field, computed once per list of listings. */
const indexCache = new WeakMap();
export function indexDirectory(providers) {
  if (indexCache.has(providers)) return indexCache.get(providers);
  const vocab = new Map(); // every word, with how many times it is used
  const known = new Map(); // words in names, types and summaries: what typos are corrected to
  const cities = new Map(); // "boca raton" -> "Boca Raton"
  const countries = new Set(); // "Israel", "France": the countries with listings
  const rows = providers.map((p) => {
    const fields = FIELDS.map(([, weight, get]) => {
      const list = words(get(p)).map(stem);
      for (const w of list) {
        vocab.set(w, (vocab.get(w) || 0) + 1);
        if (weight > 1) known.set(w, (known.get(w) || 0) + 1);
      }
      return { weight, list, set: new Set(list), text: ` ${list.join(' ')} ` };
    });
    const city = String(p?.city || '').trim();
    if (city) cities.set(words(city).join(' '), city);
    if (countryOf(p)) countries.add(countryOf(p));
    return { p, fields };
  });
  const index = { rows, vocab, known, cities, countries };
  indexCache.set(providers, index);
  return index;
}

/**
 * The word the directory uses that was most likely meant: "bakrey" is
 * "bakery", "resturant" is "restaurant". A word listings already use is
 * left alone, and so is the start of one while it is still being typed.
 */
function correct(word, { vocab, known }, isLast) {
  if (known.has(word) || (vocab.get(word) || 0) >= 3 || aliasGroup(word)) return word;
  if (isLast && word.length >= 2) for (const v of known.keys()) if (v.startsWith(word)) return word;
  const max = allowedTypos(word);
  if (!max) return word;
  // Closest first; then the one that starts the same way for longer ("bakr"
  // is bakery, not bar); then the one listings use most.
  const shared = (v) => { let i = 0; while (i < v.length && v[i] === word[i]) i++; return i; };
  let best = word, bestD = max + 1, bestP = 0, bestN = 0;
  for (const v of [...known.keys(), ...aliasPhrases().filter((t) => !t.includes(' '))]) {
    if (Math.abs(v.length - word.length) > max || (max < 2 && v[0] !== word[0])) continue;
    const d = distance(word, v, max);
    if (d > max) continue;
    const pre = shared(v), n = known.get(v) || 1;
    if (d < bestD || (d === bestD && (pre > bestP || (pre === bestP && n > bestN)))) { best = v; bestD = d; bestP = pre; bestN = n; }
  }
  return bestD <= max ? best : word;
}

// How a place found in the search is shown back: the city as listings spell
// it, a short code in capitals, anything else as typed.
function placeLabel(phrase, typed, { cities, countries }) {
  if (cities.has(phrase)) return cities.get(phrase);
  if (countries.has(countryName(phrase))) return countryName(phrase);
  if (phrase.length <= 3) return phrase.toUpperCase();
  return typed;
}

// A country that has listings, typed with the search ("mikvah Israel"). Not
// the ones that are also things people search for: a turkey is food.
const NOT_COUNTRIES = new Set(['turkey', 'china', 'jersey', 'chad', 'jordan', 'guinea', 'georgia', 'us']);
function isCountryWord(phrase, typed, { countries }) {
  if (NOT_COUNTRIES.has(phrase) || (phrase.length <= 2 && typed !== typed.toUpperCase())) return false;
  return countries.has(countryName(phrase));
}

/**
 * Read what was typed: the words to look for, and any place named with them.
 *
 * A city that has listings, a state or an alias typed into the search
 * ("bakery Boca Raton", "pizza LA") becomes the place, and the rest becomes
 * the search. Each word is made singular, corrected if it is a typo, and
 * widened to the words that mean the same thing (wholesale → wholesaler,
 * distributor; senior home → nursing home, assisted living).
 */
export function parseQuery(raw, providers = [], { findPlace = true } = {}) {
  const original = String(raw ?? '').trim();
  const index = indexDirectory(providers);
  let tokens = words(original);
  // The same words as typed, capitals kept, to tell "LA" from "la".
  const typedTokens = original.normalize('NFKD').replace(/['’]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (typedTokens.length !== tokens.length) typedTokens.splice(0, typedTokens.length, ...tokens);

  let place = '';
  for (let n = Math.min(4, tokens.length); findPlace && n >= 1 && !place; n--) {
    for (let i = tokens.length - n; i >= 0 && !place; i--) {
      const phrase = tokens.slice(i, i + n).join(' ');
      const typed = typedTokens.slice(i, i + n).join(' ');
      const upper = typed.length <= 2 && typed === typed.toUpperCase();
      if (index.cities.has(phrase) || isPlaceWord(phrase, { upper }) || isCountryWord(phrase, typed, index)) {
        place = placeLabel(phrase, typed, index);
        tokens = [...tokens.slice(0, i), ...tokens.slice(i + n)];
      }
    }
  }

  tokens = tokens.filter((t) => !STOP.has(t));
  // Multi-word names for one thing ("senior home", "pest control") stay together.
  const concepts = [];
  const asAlts = (terms) => [...new Set(terms)].map((t) => words(t).map(stem)).filter((a) => a.length);
  for (let i = 0; i < tokens.length; i++) {
    const two = tokens.slice(i, i + 2).join(' ');
    const three = tokens.slice(i, i + 3).join(' ');
    const phrase = aliasGroup(three) ? three : aliasGroup(two) ? two : null;
    if (phrase) {
      concepts.push({ typed: phrase, fixed: phrase, alts: asAlts([phrase, ...aliasGroup(phrase)]) });
      i += phrase.split(' ').length - 1;
      continue;
    }
    const isLast = i === tokens.length - 1;
    const own = stem(tokens[i]);
    const fixed = correct(own, index, isLast);
    const group = aliasGroup(fixed) || aliasGroup(tokens[i]) || aliasGroup(own) || [];
    concepts.push({
      typed: tokens[i],
      fixed,
      // What was typed still counts alongside the correction.
      alts: asAlts([fixed, own, ...group]),
      partial: isLast && fixed === own && !index.vocab.has(own),
    });
  }
  const corrected = concepts.some((c) => c.fixed !== stem(c.typed) && c.fixed !== c.typed)
    ? concepts.map((c) => (c.fixed !== stem(c.typed) ? c.fixed : c.typed)).join(' ') : '';
  return { text: original, place, concepts, corrected };
}

// How well one field answers one concept: 1 for the word itself, less for the
// start of a word while it is still being typed.
function fieldScore(field, concept) {
  let best = 0;
  for (const alt of concept.alts) {
    if (alt.length === 1) {
      if (field.set.has(alt[0])) return 1;
      if (concept.partial && alt[0].length >= 2 && field.text.includes(` ${alt[0]}`)) best = Math.max(best, 0.6);
    } else if (field.text.includes(` ${alt.join(' ')} `)) return 1;
  }
  return best;
}

/**
 * Search the directory. Every word has to be found somewhere in a listing,
 * and a place, when there is one, has to match too. A word no listing uses
 * at all ("frum", "please") is left out rather than emptying the page.
 * Returns the matching listings, best first, with what the search was read as.
 */
export function searchDirectory(providers, { q = '', where = '', anywhere = false, country = '' } = {}) {
  const first = run(providers, parseQuery(q, providers), where, anywhere, country);
  // A word that is also a town ("Deal", "Lawrence") is a word again when
  // reading it as a place finds nothing.
  if (!first.results.length && first.parsed.place && first.parsed.place !== where) {
    const again = run(providers, parseQuery(q, providers, { findPlace: false }), where, anywhere, country);
    if (again.results.length) return again;
  }
  return first;
}

// `anywhere` keeps the words but not the place, for "listed in other communities".
// The country stays: other communities in the country that was picked.
function run(providers, parsed, where, anywhere, country) {
  const index = indexDirectory(providers);
  const place = parsed.place || String(where || '').trim();
  const inPlace = anywhere ? null : placeMatcher(place, providers);
  const inChosenCountry = countryMatcher(country);
  // Listings that only match because they serve everywhere ("Nationwide",
  // "International") are marked `wide`, so a search for the Bahamas can show
  // what is in the Bahamas apart from what helps from anywhere.
  const reallyInPlace = inPlace && placeMatcher(place, providers, { everywhere: false });
  const chosen = countryName(country) || String(country || '').trim();
  const isWide = (p) => (reallyInPlace ? !reallyInPlace(p) : false) || (chosen ? countryOf(p) !== chosen : false);
  const live = parsed.concepts.filter((c) => index.rows.some((r) => r.fields.some((f) => fieldScore(f, c) > 0)));
  const nothing = parsed.concepts.length > 0 && live.length === 0;

  const results = [];
  for (const row of nothing ? [] : index.rows) {
    if (inChosenCountry && !inChosenCountry(row.p)) continue;
    if (inPlace && !inPlace(row.p)) continue;
    let score = 0, ok = true;
    for (const c of live) {
      let s = 0;
      for (const f of row.fields) s = Math.max(s, f.weight * fieldScore(f, c));
      if (!s) { ok = false; break; }
      score += s;
    }
    if (!ok) continue;
    // The whole search, word for word, in the name or type is the closest answer.
    if (live.length > 1) {
      const whole = ` ${live.map((c) => c.alts[0].join(' ')).join(' ')} `;
      if (row.fields[0].text.includes(whole) || row.fields[1].text.includes(whole)) score += 5;
    }
    results.push({ provider: row.p, score, wide: isWide(row.p) });
  }
  return { results, parsed: { ...parsed, place } };
}

/** How many listings a search finds in the place itself, for the counts beside suggestions. */
export function countMatches(providers, q, where = '', country = '') {
  return searchDirectory(providers, { q, where, country }).results.filter((r) => !r.wide).length;
}

/**
 * Counts, place by place, what a search would show in each place itself (the
 * listings that only serve from anywhere are counted apart, as the page shows
 * them). The keyword is matched once, so counting a list of places as someone
 * types stays quick. `keep` is any further filter the page applies.
 */
export function placeCounter(providers, { q = '', country = '', keep = null } = {}) {
  // Matched on first use, so a page can make one for every keystroke cheaply.
  let pool = null;
  const matched = () => pool || (pool = searchDirectory(providers, { q, anywhere: true, country }).results
    .map((r) => r.provider).filter((p) => !keep || keep(p)));
  const chosen = countryName(country) || String(country || '').trim();
  const cache = new Map();
  return (where) => {
    const key = String(where || '').trim().toLowerCase();
    if (!cache.has(key)) {
      const here = placeMatcher(where, providers, { everywhere: false });
      cache.set(key, matched().filter((p) => (!here || here(p)) && (!chosen || countryOf(p) === chosen)).length);
    }
    return cache.get(key);
  };
}

/** Keyword suggestions, each counted the way the search itself would count it. */
// A link's "country=everywhere": Everywhere picked on purpose, which a link
// with no country cannot say now that no country means "your own".
export const EVERYWHERE = 'everywhere';

/**
 * Where the Country box starts: the person's own country (`mine`), so a
 * visitor from Israel opens on Israel's listings and one from the US on the
 * US's. Everywhere instead when we do not know their country, nothing is
 * listed there, or the place typed is somewhere else: a New Yorker searching
 * Jerusalem should find Jerusalem, not an empty US list. A place with
 * nothing listed anywhere leaves the box alone.
 */
export function startingCountry(providers, mine, where = '') {
  const name = countryName(mine);
  if (!name || !providers.some((p) => countryOf(p) === name)) return '';
  const test = placeMatcher(where, providers, { everywhere: false });
  if (!test) return name;
  const found = providers.filter(test);
  return !found.length || found.some((p) => countryOf(p) === name) ? name : '';
}

export function suggestKeywords(raw, providers, categories, where = '', country = '') {
  const count = (q) => countMatches(providers, q, where, country);
  const here = inCountry(providers, country);
  const found = keywordSuggestions(raw, here, categories, count);
  if (found.length) return found;
  // Nothing starts with a typo: offer what it was probably meant to be.
  const { corrected } = parseQuery(raw, providers, { findPlace: false });
  return corrected ? keywordSuggestions(corrected, here, categories, count) : [];
}

/**
 * Place suggestions, with "Everywhere" always first, so leaving the box blank
 * is a choice on screen rather than a silent fallback. With a country picked,
 * only places in that country are suggested.
 *
 * Each number is what picking that place would show, counted by the search
 * itself: "Hollywood" also finds Hollywood Hills, and a category or keyword
 * already chosen narrows it. `countFor(place)` lets the page count with its
 * own filters; a place it would show nothing for is left out.
 */
// `near` ({ lat, lng }, optional) puts the places closest to the person first.
export function suggestPlaces(raw, providers, country = '', countFor = null, near = null) {
  const count = countFor || placeCounter(providers, { country });
  return listPlaces(raw, providers, country, near).flatMap((s) => {
    if (s.kind !== 'place' || !s.value) return [s];
    const n = count(s.value);
    return n ? [{ ...s, count: n }] : [];
  });
}

function listPlaces(raw, providers, country, near) {
  const text = String(raw || '').trim();
  const everywhere = { group: 'Places with listings', kind: 'place', label: 'Everywhere', value: '', hint: country ? `all of ${country}` : 'all communities' };
  if (!text) return [everywhere];
  const here = inCountry(providers, country);
  // Countries and states with listings, from the first letters typed: "Bah"
  // offers the Bahamas, "Flo" Florida. Cities follow.
  const wanted = country ? new Set() : countriesStarting(text);
  const countries = countriesFrom(here).filter((c) => wanted.has(c.country)).slice(0, 2)
    .map((c) => ({ group: 'Places with listings', kind: 'place', label: c.country, value: c.country, hint: 'country', count: c.count }));
  const states = (!country || country === US) && text.length >= 2 ? stateSuggestions(text, here) : [];
  return [...('everywhere'.startsWith(text.toLowerCase()) ? [everywhere] : []), ...countries, ...states, ...placeSuggestions(text, here, near)].slice(0, 8);
}

// US states with listings whose name starts a word with what was typed.
function stateSuggestions(text, providers) {
  const t = words(text).join(' ');
  if (!t) return [];
  const counts = new Map();
  for (const p of providers) {
    if (countryOf(p) !== US) continue;
    const name = stateName(p.state);
    if (name && (name.toLowerCase().startsWith(t) || name.toLowerCase().includes(` ${t}`))) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(([name, count]) => ({ group: 'Places with listings', kind: 'place', label: name, value: name, hint: 'state', count }));
}
