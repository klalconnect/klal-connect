// Directory search: plurals, typos, synonyms, places, and every word counting.
import assert from 'node:assert/strict';
import { placeCounter, searchDirectory, startingCountry, suggestPlaces } from './search.js';
import { countryOf, countriesFrom, placeLine } from './countries.js';

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log(`  ok   ${name}`); };
let n = 0;
const L = (name, category, subcategory, city, state, more = {}) => ({ id: `p${++n}`, name, category, subcategory, city, state, ...more });
const P = [
  L('Yokey Industries', 'Food & Catering', 'Factory / Co-packer', 'Miami', 'FL'),
  L('Elite Fish Wholesale', 'Food & Catering', 'Wholesale', 'Los Angeles', 'CA'),
  L('Mega Kosher Distribution', 'Food & Catering', 'Wholesale', 'Pompano Beach', 'FL', { tagline: 'Kosher food distributor' }),
  L('Levindale', 'Health', 'Nursing Home & Rehab', 'Baltimore', 'MD'),
  L('Atria', 'Health', 'Assisted Living', 'Boca Raton', 'FL'),
  L('Kings Highway Glatt', 'Food & Catering', 'Butcher', 'Brooklyn', 'NY'),
  L('Pita Pan Bakery', 'Food & Catering', 'Bakery', 'Boca Raton', 'FL'),
  L('Queens Bagels', 'Food & Catering', 'Bakery', 'Flushing', 'NY'),
  L('Chefah Catering', 'Food & Catering', 'Caterer', 'Lawrence', 'NY'),
  L('Burger Spot', 'Food & Catering', 'Restaurant', 'Flushing', 'NY'),
  L('Shalom Pizza', 'Food & Catering', 'Pizza', 'Los Angeles', 'CA'),
  L('Cajun Kosher', 'Food & Catering', 'Restaurant', 'New Orleans', 'LA'),
  L('La Vela Coffee', 'Food & Catering', 'Cafe', 'Miami Gardens', 'FL'),
  L('Chai Lifeline', 'Health', 'Support', 'Nationwide', '', { service_areas: ['Nationwide'] }),
];
const names = (q, where = '') => searchDirectory(P, { q, where }).results.sort((a, b) => b.score - a.score).map((r) => r.provider.name);

ok('plurals find the singular', () => {
  assert.deepEqual(names('factories'), ['Yokey Industries']);
  assert.deepEqual(names('butchers'), ['Kings Highway Glatt']);
});
ok('synonyms: wholesaler, distributor, senior home', () => {
  assert.deepEqual(names('wholesaler').sort(), ['Elite Fish Wholesale', 'Mega Kosher Distribution']);
  assert.deepEqual(names('senior home').sort(), ['Atria', 'Levindale']);
  assert.deepEqual(names('nursing homes').sort(), ['Atria', 'Levindale']);
});
ok('small typos are corrected and said', () => {
  assert.deepEqual(names('bakrey').sort(), ['Pita Pan Bakery', 'Queens Bagels']);
  assert.deepEqual(names('butchr'), ['Kings Highway Glatt']);
  assert.ok(names('resturant').includes('Burger Spot'));
  assert.equal(searchDirectory(P, { q: 'bakrey' }).parsed.corrected, 'bakery');
});
ok('caterer finds caterers, not every Food & Catering listing', () => {
  assert.deepEqual(names('caterer'), ['Chefah Catering']);
});
ok('FL is Florida, not Flushing', () => {
  const fl = names('', 'FL');
  assert.ok(fl.includes('Pita Pan Bakery') && !fl.includes('Queens Bagels') && !fl.includes('Burger Spot'));
});
ok('LA is Los Angeles, not Louisiana; NYC covers Flushing', () => {
  const la = names('', 'LA');
  assert.ok(la.includes('Shalom Pizza') && !la.includes('Cajun Kosher'));
  assert.ok(names('', 'NYC').includes('Queens Bagels'));
  assert.ok(names('', 'Louisiana').includes('Cajun Kosher'));
});
ok('every word counts: wholesale food, bakery Boca Raton, pizza LA', () => {
  assert.equal(names('wholesale food')[0], 'Mega Kosher Distribution');
  assert.ok(names('wholesale food').includes('Elite Fish Wholesale'));
  assert.deepEqual(names('bakery Boca Raton'), ['Pita Pan Bakery']);
  assert.deepEqual(names('pizza LA'), ['Shalom Pizza']);
  assert.deepEqual(names('la vela'), ['La Vela Coffee']);
});
ok('a blank place is everywhere, and nationwide listings serve every place', () => {
  assert.equal(names('').length, P.length);
  assert.ok(names('', 'Boca Raton').includes('Chai Lifeline'));
  assert.ok(names('', 'Boca').includes('Pita Pan Bakery'));
});

// Countries: listings outside the US, the Country filter, and a country typed as the place.
const W = [
  ...P,
  L('Mikvah Yerushalayim', 'Mikvas', "Women's Mikvah", 'Jerusalem', 'IL-JM', { country: 'Israel', tagline: 'Mikvah in Jerusalem, Israel' }),
  L('Mikvah Ramat Beit Shemesh', 'Mikvas', "Women's Mikvah", 'Beit Shemesh', '', { country: 'Israel' }),
  L('Mikvah de Paris', 'Mikvas', "Women's Mikvah", 'Paris', '', { country: 'France' }),
  L('Mikvah Perth', 'Mikvas', "Women's Mikvah", 'Perth', 'WA', { country: 'Australia' }),
  L('Seattle Mikvah', 'Mikvas', "Women's Mikvah", 'Seattle', 'WA'),
  L('Torah by Phone', 'Education', 'Shiurim', '', '', { service_areas: ['Worldwide'] }),
  L('OHEL', 'Health', 'Support', 'Brooklyn', 'NY', { service_areas: ['Nationwide'] }),
];
const inC = (q, country, where = '') => searchDirectory(W, { q, where, country }).results.map((r) => r.provider.name).sort();
ok('a listing in a US state is in the United States without saying so', () => {
  assert.equal(countryOf({ state: 'FL' }), 'United States');
  assert.equal(countryOf({ state: 'New York' }), 'United States');
  assert.equal(countryOf({ state: 'WA', country: 'Australia' }), 'Australia');
  assert.equal(countryOf({ state: 'IL-JM' }), '');
});
ok('the Country filter keeps to that country; worldwide listings show in every one', () => {
  assert.deepEqual(inC('mikvah', 'Israel'), ['Mikvah Ramat Beit Shemesh', 'Mikvah Yerushalayim']);
  assert.deepEqual(inC('mikvah', 'United States'), ['Seattle Mikvah']);
  assert.deepEqual(inC('mikvah', ''), ['Mikvah Perth', 'Mikvah Ramat Beit Shemesh', 'Mikvah Yerushalayim', 'Mikvah de Paris', 'Seattle Mikvah']);
  assert.ok(inC('', 'Israel').includes('Torah by Phone'));
  // Nationwide is the listing's own country, not Israel.
  assert.ok(!inC('', 'Israel').includes('OHEL'));
});
ok('a US state is a US place: WA is not Perth', () => {
  assert.deepEqual(inC('mikvah', '', 'WA'), ['Seattle Mikvah']);
});
ok('a country typed in Where or with the search', () => {
  assert.deepEqual(inC('', '', 'Israel').filter((n) => n.startsWith('Mikvah')), ['Mikvah Ramat Beit Shemesh', 'Mikvah Yerushalayim']);
  assert.deepEqual(inC('mikvah israel', ''), ['Mikvah Ramat Beit Shemesh', 'Mikvah Yerushalayim']);
  assert.equal(searchDirectory(W, { q: 'mikvah france' }).parsed.place, 'France');
  // A US nationwide listing serves US places, not Paris.
  assert.ok(!inC('', '', 'Paris').includes('OHEL'));
  assert.ok(inC('', '', 'Boca Raton').includes('OHEL'));
});
ok('the filter lists countries with listings, US first; places follow the country', () => {
  assert.deepEqual(countriesFrom(W).map((c) => c.country), ['United States', 'Israel', 'Australia', 'France']);
  assert.deepEqual(suggestPlaces('Pe', W, 'Australia').map((s) => s.label), ['Perth']);
  assert.equal(placeLine({ city: 'Paris', country: 'France' }), 'Paris, France');
  assert.equal(placeLine({ city: 'Boca Raton', state: 'FL' }), 'Boca Raton, FL');
});
const B = [...W, L('Chabad of the Bahamas', 'Shuls', 'Chabad', 'Nassau', 'OTHER', { country: 'Bahamas' })];
const split = (where, country = '') => {
  const r = searchDirectory(B, { where, country }).results;
  return { local: r.filter((x) => !x.wide).map((x) => x.provider.name), wide: r.filter((x) => x.wide).map((x) => x.provider.name) };
};
ok('a place search keeps "serves everywhere" listings apart from the ones there', () => {
  assert.deepEqual(split('Bahamas').local, ['Chabad of the Bahamas']);
  assert.ok(split('Bahamas').wide.includes('Torah by Phone'));
  assert.deepEqual(split('', 'Bahamas').local, ['Chabad of the Bahamas']);
  assert.ok(split('', 'Bahamas').wide.includes('Torah by Phone'));
  assert.ok(split('Boca Raton').wide.includes('OHEL'));
  assert.ok(!split('Boca Raton').local.includes('OHEL'));
  // In its own city, a nationwide listing is local.
  assert.ok(split('Brooklyn').local.includes('OHEL'));
  assert.deepEqual(split(''), { local: B.map((p) => p.name), wide: [] });
});
ok('the Where box reacts from the first letters, for countries and states too', () => {
  assert.deepEqual(split('Bah').local, ['Chabad of the Bahamas']);
  assert.deepEqual(suggestPlaces('Bah', B).map((s) => s.label), ['Bahamas', 'Nassau']);
  assert.equal(suggestPlaces('Bah', B)[1].hint, 'Bahamas');
  assert.equal(suggestPlaces('Isr', B)[0].label, 'Israel');
  assert.equal(suggestPlaces('Flo', B)[0].label, 'Florida');
  assert.equal(suggestPlaces('Eng', B).length, 0);
});
ok('place counts match what picking the place shows', () => {
  const H = [
    L('Grill One', 'Food & Catering', 'Restaurant', 'Hollywood', 'FL'),
    L('Grill Two', 'Food & Catering', 'Restaurant', 'Hollywood', 'FL'),
    L('Young Israel of Hollywood', 'Shuls', 'Shul', 'Hollywood', 'FL'),
    L('Hills Bakery', 'Food & Catering', 'Bakery', 'Hollywood Hills', 'FL'),
    L('Relief Resources', 'Health', 'Therapist', 'Brooklyn', 'NY', { service_areas: ['Nationwide'] }),
  ];
  const shown = (where, keep = () => true) => searchDirectory(H, { where }).results.filter((r) => !r.wide && keep(r.provider)).length;
  const first = suggestPlaces('Hollywood', H)[0];
  assert.equal(first.label, 'Hollywood');
  assert.equal(first.count, shown('Hollywood')); // Hollywood Hills too, not the nationwide one
  assert.equal(first.count, 4);
  // With a category chosen, the number is that category's.
  const food = (p) => p.category === 'Food & Catering';
  assert.equal(suggestPlaces('Hollywood', H, '', placeCounter(H, { keep: food }))[0].count, shown('Hollywood', food));
  // A place with nothing for the search is not offered.
  assert.deepEqual(suggestPlaces('Hollywood', H, '', placeCounter(H, { q: 'shul' })).map((s) => [s.label, s.count]), [['Hollywood', 1]]);
});
ok('the Country box starts on your own country, unless the place is elsewhere', () => {
  const W = [
    L('Kings Highway Glatt', 'Food & Catering', 'Butcher', 'Brooklyn', 'NY'),
    L('Mikvah Yerushalayim', 'Mikvas', "Women's Mikvah", 'Jerusalem', '', { country: 'Israel' }),
  ];
  assert.equal(startingCountry(W, 'US'), 'United States');
  assert.equal(startingCountry(W, 'IL'), 'Israel');
  assert.equal(startingCountry(W, ''), ''); // not known: Everywhere
  assert.equal(startingCountry(W, 'FR'), ''); // nothing listed there: Everywhere
  assert.equal(startingCountry(W, 'US', 'Brooklyn'), 'United States');
  assert.equal(startingCountry(W, 'US', 'Jerusalem'), ''); // a place abroad: Everywhere
  assert.equal(startingCountry(W, 'US', 'Bro'), 'United States'); // still typing
  assert.equal(startingCountry(W, 'US', 'Lakewood'), 'United States'); // nothing listed there yet
});
console.log(`\n${passed} passed`);
