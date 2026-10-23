// Keeps the directory's categories current without anyone pressing a button.
//
// Adding a category to src/lib/categories.js used to do nothing for a running
// directory: the seeder only touches an empty database, so each new one needed
// an admin to open Admin -> Categories and press "Add all" — or someone to
// point a CLI at a production DATABASE_URL. Now the first request an instance
// serves offers whatever it has never offered before.
//
// Offered once, not enforced. The names already offered are recorded in a
// Setting row, so a category an admin deliberately removes does not reappear
// on the next cold start. Anything already present by name is left exactly as
// it is — never renamed, re-iconed or reordered. Additive only.
import { store } from './db.js';
import { stableId } from './db-shared.js';
import { DIRECTORY_CATEGORIES } from '../src/lib/categories.js';
import { fixListingTypes } from './listing-types.js';
import { fillListingCountries } from './listing-countries.js';
import { fillListingKitchens } from './listing-kitchens.js';
import { fixListingRepeats, fixGarbledNames, removeDuplicateListing } from './listing-repeats.js';

const KEY = 'categories_offered';
const SHULS_MOVED = 'community_shuls_removed';
const INSURANCE_SPLIT = 'insurance_own_category_2026_10_19';
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

let started = null;

/** Adds any category the app has never offered. Returns the names added. */
export function ensureCoreCategories() {
  // Memoised so a burst of cold-start requests shares one pass instead of
  // each racing to create the same rows.
  if (!started) {
    started = run().catch((err) => {
      started = null; // let the next request retry rather than cache a failure
      console.warn(`[categories] could not ensure categories: ${err.message}`);
      return [];
    });
  }
  return started;
}

async function run() {
  const marker = (await store.filter('Setting', { key: KEY }))[0];
  const offered = new Set(marker?.value ? JSON.parse(marker.value) : []);
  const existing = new Set((await store.list('Category')).map((c) => String(c.name || '').trim().toLowerCase()));

  const added = [];
  for (const c of DIRECTORY_CATEGORIES) {
    const lower = c.name.toLowerCase();
    // On the first run against a directory that predates the marker nothing
    // has been recorded, so anything missing is added once — including a
    // category someone removed earlier. From then on a removal sticks.
    if (offered.has(lower)) continue;
    offered.add(lower);
    if (existing.has(lower)) continue;
    await store.create('Category', { ...c, id: stableId('Category', c.name), slug: slugify(c.name), active: true });
    added.push(c.name);
  }

  // Only write the marker when something is new, so a warm directory costs two
  // reads and no writes.
  const list = JSON.stringify([...offered]);
  if (!marker) await store.create('Setting', { key: KEY, value: list });
  else if (marker.value !== list) await store.update('Setting', marker.id, { value: list });
  if (added.length) console.log(`[categories] added ${added.join(', ')}`);
  await dropShulsFromCommunity();
  await splitOutInsurance();
  await fixListingTypes();
  await fillListingCountries();
  await fillListingKitchens();
  await fixListingRepeats();
  await fixGarbledNames();
  await removeDuplicateListing();
  return added;
}

// Shuls used to be offered twice: as a Community subcategory and as their own
// "Shuls & Minyanim" category. The list above changed, but a running directory
// keeps the subcategories it was created with, so this takes "Shuls" out of
// Community once. Recorded, so an admin who puts it back is not overruled.
async function dropShulsFromCommunity() {
  if ((await store.filter('Setting', { key: SHULS_MOVED })).length) return;
  for (const c of await store.list('Category')) {
    if (String(c.name || '').trim().toLowerCase() !== 'community' || !Array.isArray(c.subcategories)) continue;
    const kept = c.subcategories.filter((s) => String(s).trim().toLowerCase() !== 'shuls');
    if (kept.length !== c.subcategories.length) await store.update('Category', c.id, { subcategories: kept });
  }
  await store.create('Setting', { key: SHULS_MOVED, value: '1' });
}

// Insurance got its own category (and shuls their own icon) on 2026-10-19.
// Like the shuls move above, a running directory keeps what it was created
// with, so this takes "Insurance" out of Financial's subcategories, swaps the
// shuls card off Financial's bank building onto a Torah scroll, and moves
// shuls up to third on Resources (Eli asked), once. Recorded, so an admin who
// changes any of it back is not overruled.
async function splitOutInsurance() {
  if ((await store.filter('Setting', { key: INSURANCE_SPLIT })).length) return;
  for (const c of await store.list('Category')) {
    const name = String(c.name || '').trim().toLowerCase();
    if (name === 'financial' && Array.isArray(c.subcategories)) {
      const kept = c.subcategories.filter((s) => String(s).trim().toLowerCase() !== 'insurance');
      if (kept.length !== c.subcategories.length) await store.update('Category', c.id, { subcategories: kept });
    }
    if (name === 'shuls & minyanim' && (!c.icon || c.icon === 'Landmark' || c.icon === 'MoreHorizontal')) {
      await store.update('Category', c.id, { icon: 'TorahScroll' });
    }
  }
  await moveShulsToThird();
  await store.create('Setting', { key: INSURANCE_SPLIT, value: '1' });
}

// Third, after Home Services and Business: everything from third down shifts
// one place, so the admin list keeps whole numbers. Skipped if an admin has
// already moved shuls into the top three.
async function moveShulsToThird() {
  const all = await store.list('Category');
  const shuls = all.find((c) => String(c.name || '').trim().toLowerCase() === 'shuls & minyanim');
  if (!shuls || Number(shuls.order) <= 3) return;
  for (const c of all) {
    if (c.id === shuls.id) continue;
    const order = Number(c.order);
    if (order >= 3 && order < 99) await store.update('Category', c.id, { order: order + 1 });
  }
  await store.update('Category', shuls.id, { order: 3 });
}
