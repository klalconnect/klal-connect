// What Resources leads with before anyone has said what they want.
//
// Closest first on its own opened on whatever happened to be nearest, which in
// most towns is a shul or a mikvah: nine in ten listings are one or the other,
// so an open page read as a shul directory. Nobody uses the listings enough
// yet for "popular" to come from numbers, so the order is chosen: the things
// people look up week to week first, then the rest, and shuls and mikvaos last
// because they are already known to everyone who needs them nearby.
// Eli asked for this 2026-10-23.
const EVERYDAY = ['Food & Catering', 'Gemachim', 'Simcha Services', 'Health', 'Home Services', 'Education', 'Community'];
const LAST = ['Shuls & Minyanim', 'Mikvas'];

// Lower comes first.
export function everydayRank(category) {
  const i = EVERYDAY.indexOf(category);
  if (i >= 0) return i;
  return LAST.includes(category) ? 100 + LAST.indexOf(category) : 50;
}

// Within this many miles the everyday order wins over distance, so a
// restaurant twenty minutes away comes before a shul around the corner, but a
// restaurant in another state never beats something in town.
export const EVERYDAY_MILES = 30;

// The quick picks above the results, shown until a category is chosen. Each is
// a real category, so tapping one is the same as picking it in the box.
export const QUICK_CATEGORIES = [
  { name: 'Food & Catering', label: 'Restaurants & food' },
  { name: 'Gemachim', label: 'Gemachs' },
  { name: 'Shuls & Minyanim', label: 'Shuls' },
  { name: 'Mikvas', label: 'Mikvahs' },
  { name: 'Education', label: 'Schools' },
  { name: 'Health', label: 'Health' },
  { name: 'Simcha Services', label: 'Simchas' },
  { name: 'Community', label: 'Community' },
];

// What the chosen category is called on its pick.
export const quickLabel = (name) => QUICK_CATEGORIES.find((c) => c.name === name)?.label || name;

// The second row of picks, once a category is chosen: the kinds of listing
// inside it that the search on screen actually has, so every pick leads
// somewhere. Restaurants & food leads with the kitchen (meat, dairy, pareve,
// both) and keeps the kinds of shop for More. Eli asked for this 2026-10-23,
// in place of the Meat / Dairy box in the filters.
//
// Subcategories are typed by whoever added the listing, so near-identical ones
// are folded together and given a plural name; anything not named here shows
// as typed.
const KIND_NAMES = {
  restaurant: 'Restaurants', restaurants: 'Restaurants',
  caterer: 'Caterers', bakery: 'Bakeries', grocery: 'Groceries',
  pizza: 'Pizza', 'pizza restaurant': 'Pizza', cafe: 'Cafés',
  butcher: 'Butchers', 'kosher market / butcher': 'Butchers', 'kosher market': 'Kosher markets',
  'fish store': 'Fish stores', fish: 'Fish stores',
  'ice cream': 'Ice cream', 'ice cream / gelato': 'Ice cream',
  sweets: 'Sweets', 'sweets & desserts': 'Sweets',
  'donut & coffee shop': 'Donuts & coffee', 'donut shop': 'Donuts & coffee', 'coffee shop': 'Cafés',
  'kosher butcher': 'Butchers', 'ice cream and frozen yogurt': 'Ice cream', takeout: 'Takeout',
  "women's mikvah": "Women's", "men's mikvah": "Men's",
  shuls: 'Shuls', minyanim: 'Minyanim',
  'emergency medical services': 'Emergency medical',
};

// The group a listing's subcategory falls in, as { id, label }, or null.
export function kindOf(provider) {
  const typed = String(provider?.subcategory ?? '').trim();
  if (!typed) return null;
  const label = KIND_NAMES[typed.toLowerCase()] || typed;
  return { id: label.toLowerCase(), label };
}

// Kitchen picks in the order Eli named them. "Meat" and "Dairy" also find
// places with both kitchens, the way the filter always has.
const KITCHEN_PICKS = [
  { id: 'meat', label: 'Meat' }, { id: 'dairy', label: 'Dairy' }, { id: 'pareve', label: 'Pareve' },
  { id: 'meat_dairy', label: 'Meat & dairy' }, { id: 'fish', label: 'Fish' },
];

export const PICKS_SHOWN = 5;
// More stays short: a kind with only a listing or two is noise there (one
// gas station, one hospital kitchen), and a dozen is plenty to scan.
const KIND_MIN = 3, PICKS_MAX = 12;

/**
 * The picks for one category, given the listings in that category on screen.
 * Each is { kind: 'kitchen' | 'type', id, label }. A pick that would show
 * exactly what is already showing narrows nothing, so it is left out.
 */
export function categoryPicks(rows, { kitchenFor, kitchens }) {
  const picks = [];
  if (kitchens) {
    for (const k of KITCHEN_PICKS) {
      const n = rows.filter((p) => kitchenFor(p, k.id)).length;
      if (n > 0 && n < rows.length) picks.push({ kind: 'kitchen', id: k.id, label: k.label });
    }
  }
  const kinds = new Map();
  for (const p of rows) {
    const k = kindOf(p);
    if (!k) continue;
    const seen = kinds.get(k.id) || { ...k, n: 0 };
    seen.n += 1;
    kinds.set(k.id, seen);
  }
  // A rare kind is left out, unless the category has only a few kinds in
  // all: Men's is one mikvah, but it is still half of the choice.
  [...kinds.values()].filter((k) => k.n < rows.length && (k.n >= KIND_MIN || kinds.size <= PICKS_SHOWN)).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .forEach((k) => picks.push({ kind: 'type', id: k.id, label: k.label }));
  return picks.slice(0, PICKS_MAX);
}
