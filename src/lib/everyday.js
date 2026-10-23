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
