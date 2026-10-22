import { categoryLabel } from './categories.js';
import { countryOf, US } from './countries.js';
import { milesBetween, placePoint } from './nearby.js';

// Search aliases.
//
// Two things break plain substring search in a directory like this one.
//
// Transliterated Hebrew and Yiddish has no canonical spelling: mikvah, mikva,
// mikveh and mikvas are the same place, and whoever is typing will not guess
// which one it was filed under. And the word people search is rarely the word
// a category is named — nobody looks for "Plumbing", they look for a
// "plumber"; "exterminator" and "pest control" are one job.
//
// Each group below is a set of interchangeable terms. Typing any member
// searches for all of them, so spelling stops deciding whether someone finds
// help. Add to it freely — a missing alias is a search that silently fails.
const GROUPS = [
  // Home and trades
  ['plumber', 'plumbers', 'plumbing'],
  ['electrician', 'electricians', 'electrical', 'electric'],
  ['exterminator', 'pest control', 'pest'],
  ['handyman', 'handy man', 'repair', 'repairs'],
  ['cleaner', 'cleaners', 'cleaning', 'housekeeping', 'housekeeper'],
  ['locksmith', 'locks'],
  ['mover', 'movers', 'moving'],
  ['contractor', 'contracting', 'renovation', 'renovations'],
  ['painter', 'painting'],
  ['landscaper', 'landscaping', 'gardener', 'lawn'],
  ['appliance repair', 'appliances'],
  ['hvac', 'air conditioning', 'heating', 'ac repair'],

  // Jewish community life
  ['mikvah', 'mikva', 'mikveh', 'mikvas', 'mikvaos', 'mikvahs'],
  ['shul', 'shuls', 'shul/synagogue', 'synagogue', 'synagogues', 'shtiebel', 'shtiebels', 'shtieblach', 'beis medrash', 'bais medrash', 'minyan', 'minyanim'],
  ['gemach', 'gemachim', 'gemachs', 'gemmach'],
  ['yeshiva', 'yeshivah', 'yeshivas', 'yeshivos', 'mesivta'],
  ['cheder', 'chadarim', 'day school'],
  ['seminary', 'seminaries'],
  ['kollel', 'kollelim'],
  ['shidduch', 'shidduchim', 'shadchan', 'shadchanim', 'matchmaker', 'matchmaking'],
  ['mohel', 'mohelim', 'bris'],
  ['sofer', 'sofrim', 'scribe', 'stam'],
  ['sheitel', 'sheitl', 'shaitel', 'sheitels', 'wig', 'wigs', 'wig macher'],
  ['chesed', 'chessed'],
  ['bikur cholim', 'bikkur cholim'],
  ['chevra kadisha', 'chevrah kadisha'],
  ['eruv', 'eiruv'],
  ['kashrus', 'kashrut', 'hashgacha', 'kosher supervision'],
  ['tomchei shabbos', 'tomchei shabbas', 'food pantry', 'food bank', 'soup kitchen', 'hunger', 'free food', 'meals'],

  // Health and therapy
  //
  // "mental health" is in this group because that is how organisations
  // describe themselves while people search for a "therapist". Without it,
  // searching therapist returned nothing while two mental-health services
  // sat in the directory — which is the exact failure this file exists to
  // prevent. Alias the words help is offered under to the words help is
  // asked for.
  ['therapist', 'therapists', 'therapy', 'counselor', 'counsellor', 'counseling', 'counselling',
    'mental health', 'mental health services', 'behavioral health', 'behavioural health', 'emotional support'],
  ['crisis', 'crisis intervention', 'emergency help', 'crisis center', 'crisis centre'],
  ['abuse', 'sexual abuse', 'neglect', 'safety'],
  ['addiction', 'substance abuse', 'recovery', 'rehab'],
  ['infertility', 'fertility', 'ivf'],
  ['foster care', 'foster', 'adoption', 'adoptive'],
  ['bereavement', 'grief', 'shiva', 'loss'],
  ['special needs', 'disability', 'disabilities', 'developmental'],
  ['physical therapy', 'physiotherapy', 'physio', 'pt'],
  ['occupational therapy', 'ot'],
  ['speech therapy', 'speech', 'slp', 'speech language'],
  ['psychiatrist', 'psychiatry'],
  ['psychologist', 'psychology'],
  ['social worker', 'lcsw', 'msw'],
  ['dentist', 'dentists', 'dentistry', 'dental', 'orthodontist', 'orthodontics'],
  ['pediatrician', 'pediatrics', 'paediatrician', 'paediatrics', 'peds'],
  ['doctor', 'doctors', 'physician', 'md'],
  ['midwife', 'doula', 'lactation'],
  ['optometrist', 'optician', 'eye doctor', 'glasses'],
  ['pharmacy', 'pharmacist', 'chemist'],
  ['chiropractor', 'chiropractic'],
  ['nutritionist', 'dietitian', 'dietician'],

  // Simcha and services
  ['caterer', 'caterers', 'catering'],
  ['bakery', 'bakeries', 'baker', 'bakeshop', 'bake shop', 'bakehouse', 'patisserie'],
  ['restaurant', 'restaurants', 'takeout', 'take out'],
  ['pizza', 'pizzeria', 'pizza shop'],
  ['butcher', 'butchers', 'butcher shop', 'meat market'],
  ['factory', 'factories', 'manufacturer', 'manufacturers', 'manufacturing', 'co-packer', 'copacker', 'co packer', 'producer'],
  ['wholesale', 'wholesaler', 'wholesalers', 'distributor', 'distributors', 'distribution', 'supplier', 'suppliers'],
  ['senior home', 'nursing home', 'nursing homes', 'senior residence', 'assisted living', 'senior living',
    'retirement home', 'senior care', 'elder care', 'eldercare', 'adult home'],
  ['photographer', 'photographers', 'photography', 'photo'],
  ['videographer', 'video', 'videography'],
  ['florist', 'flowers', 'floral'],
  ['band', 'music', 'musician', 'one man band', 'singer'],
  ['hall', 'venue', 'simcha hall'],
  ['invitations', 'invites', 'stationery'],
  ['simcha', 'simchas', 'wedding', 'weddings', 'bar mitzvah', 'bas mitzvah', 'bat mitzvah', 'sheva brachos'],

  // Professional
  ['accountant', 'accountants', 'accounting', 'cpa', 'bookkeeper', 'bookkeeping'],
  ['lawyer', 'lawyers', 'attorney', 'attorneys', 'legal', 'law'],
  ['mortgage', 'mortgages', 'lender', 'loan officer'],
  ['insurance', 'insurance broker', 'insurance agent'],
  ['realtor', 'real estate', 'realty', 'real estate agent'],
  ['tutor', 'tutors', 'tutoring'],
  ['babysitter', 'babysitting', 'childcare', 'daycare', 'playgroup', 'nanny'],
  ['it support', 'computer repair', 'tech support', 'computers'],
  ['web developer', 'web development', 'website', 'web design'],
  ['graphic designer', 'graphic design', 'design'],
  ['car service', 'taxi', 'driver', 'limo', 'transportation'],
  ['mechanic', 'auto repair', 'car repair', 'body shop'],
  ['travel agent', 'travel', 'flights'],
];

// Every term, pointing at the group it belongs to.
const INDEX = new Map();
for (const group of GROUPS) {
  for (const term of group) INDEX.set(term, group);
}

/** The words that mean the same as `term`, or null. */
export function aliasGroup(term) {
  return INDEX.get(String(term || '').trim().toLowerCase()) || null;
}

/** Every term in every alias group. */
export function aliasPhrases() {
  return [...INDEX.keys()];
}

/**
 * Every spelling worth searching for, given what someone typed.
 * The original text always comes first so an exact phrase still wins.
 */
export function expandQuery(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return [];
  const terms = new Set([text]);
  // The whole phrase, then each word in it — so "frum plumber" still reaches
  // a listing filed under "Plumbing".
  for (const token of [text, ...text.split(/\s+/)]) {
    const group = INDEX.get(token);
    if (group) for (const term of group) terms.add(term);
  }
  return [...terms];
}

/**
 * Everything about a listing that a search should look at.
 *
 * Shared, because the homepage counts how many listings a quick link will
 * return and the directory decides which ones to show. Assembled twice, those
 * two drift, and a tile that promises four results delivers three.
 */
export function providerHaystack(p) {
  return [
    // The on-screen names too, so a listing filed as "Synagogue" is found by
    // the "Shul/Synagogue" it is shown as.
    p?.name, p?.tagline, p?.category, p?.subcategory, categoryLabel(p?.category), categoryLabel(p?.subcategory),
    p?.short_description, p?.description, (p?.service_areas || []).join(' '),
  ].join(' ');
}

/** Does this text satisfy the query, allowing for aliases? */
export function matchesQuery(haystack, terms) {
  if (!terms.length) return true;
  const hay = String(haystack || '').toLowerCase();
  return terms.some((term) => hay.includes(term));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does `text` contain `term` at the start of a word? "shul" is in "Shul/Synagogue", not in "Schulman". */
export function startsWord(text, term) {
  if (!term) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRe(term)}`, 'i').test(String(text || ''));
}

/** Does `text` contain `term` as a whole word? "shul" is a word in "Modern shul", not in "Shulman". */
export function hasWord(text, term) {
  if (!term) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRe(term)}($|[^a-z0-9])`, 'i').test(String(text || ''));
}

/**
 * How directly a listing answers the query, for ordering results.
 *
 * Every listing that mentions the search somewhere is still a result, but the
 * ones that are what was asked for come first. Each word typed is scored on
 * where it is found: in the name or category (best), in the one-line summary,
 * or only further down. The whole phrase found in the name or category counts
 * extra. So "pizza restaurant" puts a pizza restaurant ahead of every other
 * restaurant, and "shul" opens on the shuls rather than on a restaurant whose
 * description says it is near one.
 */
export function relevance(p, raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return 0;
  const strong = [p?.name, p?.category, p?.subcategory, categoryLabel(p?.category), categoryLabel(p?.subcategory)].join(' ');
  const middle = [p?.tagline, p?.short_description].join(' ');
  const all = providerHaystack(p);
  // A word counts as itself or any of its aliases. The last word may still be
  // being typed, so the start of a word also counts, for less: "piz" finds the
  // pizza place, but "shul" does not rank Shulman Dentistry with the shuls.
  const whole = (hay, alts) => alts.some((t) => hasWord(hay, t));
  const words = text.split(/\s+/).filter((w) => w.length > 1);
  let score = 0;
  words.forEach((word, i) => {
    const alts = [word, ...(INDEX.get(word) || [])];
    const last = i === words.length - 1;
    score += whole(strong, alts) ? 3 : whole(middle, alts) ? 2 : whole(all, alts) ? 1
      : last && startsWord(strong, word) ? 1 : 0;
  });
  const phrase = [text, ...(INDEX.get(text) || [])];
  if (phrase.some((t) => hasWord(strong, t))) score += 5;
  else if (phrase.some((t) => hasWord(middle, t))) score += 2;
  return score;
}

/**
 * What to offer under the keyword box while someone types.
 *
 * Categories first (picking one filters to it), then the words people search
 * for that have listings behind them, then listings by name (picking one opens
 * it). Each comes with how many listings it would show, and nothing is offered
 * that would lead to an empty page.
 */
export function keywordSuggestions(raw, providers, categories = [], countFor = null) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return [];
  const count = countFor || ((q) => {
    const terms = expandQuery(q);
    return providers.filter((p) => matchesQuery(providerHaystack(p), terms)).length;
  });
  const seen = new Set();
  const fresh = (label) => {
    const k = String(label).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  };

  // A category is offered when its name starts with what was typed, or when
  // what was typed is one of the words for it ("synagogue" -> Shuls & Minyanim).
  const typedTerms = expandQuery(text);
  const cats = [];
  for (const c of categories) {
    const label = categoryLabel(c.name);
    const n = providers.filter((p) => p.category === c.name).length;
    if (!n || cats.length >= 3) continue;
    const named = startsWord(label, text);
    const aliased = typedTerms.some((t) => startsWord(label, t) || (c.subcategories || []).some((s) => startsWord(categoryLabel(s), t)));
    if ((named || aliased) && fresh(label)) cats.push({ group: 'Categories', kind: 'category', label, value: c.name, count: n });
  }

  // Searches: the subcategories listings are actually filed under, shown by
  // their on-screen name, then the everyday words ("plu" offers plumber).
  const queries = [];
  const subs = new Map();
  for (const p of providers) {
    const label = categoryLabel(p.subcategory);
    if (typeof label === 'string' && label && startsWord(label, text)) subs.set(label, (subs.get(label) || 0) + 1);
  }
  for (const [label] of [...subs].sort((a, b) => b[1] - a[1])) {
    if (queries.length < 3 && fresh(label)) queries.push({ group: 'Searches', kind: 'query', label, value: label, count: count(label) });
  }
  for (const group of GROUPS) {
    if (queries.length >= 4) break;
    const term = group.find((t) => t.startsWith(text));
    // One suggestion per meaning: "shul" adds nothing under "Shul/Synagogue".
    if (!term || group.some((t) => seen.has(t))) continue;
    const n = count(term);
    if (n && fresh(term)) queries.push({ group: 'Searches', kind: 'query', label: term, value: term, count: n });
  }

  const listings = providers
    .filter((p) => startsWord(p.name, text))
    .sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0))
    .slice(0, 5)
    .map((p) => ({ group: 'Listings', kind: 'listing', label: p.name, value: p, hint: [categoryLabel(p.subcategory || p.category), p.city].filter(Boolean).join(' · ') }));
  return [...cats, ...queries, ...listings];
}

/** Places that have listings, matched against what was typed. */
export function placeSuggestions(raw, providers, near = null) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return [];
  const byCity = new Map();
  for (const p of providers) {
    const city = String(p.city || '').trim();
    if (!city) continue;
    const key = city.toLowerCase();
    // "OTHER" is the listing form's state for somewhere outside the US.
    const state = /^other$/i.test(String(p.state || '').trim()) ? '' : String(p.state || '').trim();
    const row = byCity.get(key) || { city, states: new Map(), country: countryOf(p), count: 0 };
    row.count += 1;
    if (state) row.states.set(state, (row.states.get(state) || 0) + 1);
    byCity.set(key, row);
  }
  // A city's state is the one most of its listings give: one stray "Ohio"
  // does not move Lakewood.
  for (const r of byCity.values()) r.state = [...r.states].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  // A city outside the US also answers to its country: "Bah" offers Nassau.
  const abroad = (r) => text.length >= 3 && r.country && r.country !== US && startsWord(r.country, text);
  // A name that starts with what was typed beats one that only has it inside:
  // "boi" is Boise before Clichy-sous-Bois. Within each, the nearest first
  // when we know where the person is, else the one with the most listings.
  const starts = (r) => r.city.toLowerCase().startsWith(text);
  const far = (r) => {
    if (!near) return 0;
    const at = placePoint({ city: r.city, state: r.state, country: r.country });
    return at ? milesBetween(near.lat, near.lng, at.lat, at.lng) : Infinity;
  };
  return [...byCity.values()]
    .filter((r) => startsWord(r.city, text) || startsWord(`${r.city} ${r.state}`, text) || startsWord(`${r.city}, ${r.state}`, text) || abroad(r))
    .map((r) => ({ ...r, starts: starts(r), miles: far(r) }))
    .sort((a, b) => Number(b.starts) - Number(a.starts) || a.miles - b.miles || b.count - a.count)
    .slice(0, 6)
    .map((r) => ({ group: 'Places with listings', kind: 'place', label: r.city, value: r.city,
      hint: [r.state, r.country && r.country !== US && r.country !== r.state ? r.country : ''].filter(Boolean).join(', '), count: r.count }));
}
