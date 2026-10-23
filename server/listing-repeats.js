// Doubled words in imported listing text, removed once (approved by Eli,
// 2026-10-22): "Kosher kosher caterer", "North Miami Beach kosher kosher
// butcher", and one "Restaurant and and Bar". The importers put "kosher" in
// front of a type that already said it. The full before-and-after list is in
// /listing-cleanup/repeated-words.md in the project folder.
//
// Only these two words are fixed. Other doubles in the directory are real —
// The Late Late Minyan, Row Row Chicken, "Rav Y Y Feigelstock", "listing for
// For Juice Sake" — so this is not a general "remove any repeated word" rule.
// Names are left alone. The pass is recorded once finished, so text an owner
// writes later is never touched. It runs on a cold start, so each pass stops
// after a few seconds and the next one carries on.
import { store } from './db.js';

const KEY = 'listing_repeated_words_fixed_2026_10_22';
const BUDGET_MS = 6000;
const FIELDS = ['tagline', 'short_description', 'description'];

export const dropRepeatedWords = (text) => String(text)
  .replace(/\b(kosher)\s+kosher\b/gi, '$1')
  .replace(/\b(and)\s+and\b/gi, '$1');

export async function fixListingRepeats({ budgetMs = BUDGET_MS } = {}) {
  if ((await store.filter('Setting', { key: KEY })).length) return 0;
  const started = Date.now();
  const todo = [];
  for (const p of await store.list('Provider')) {
    const patch = {};
    for (const f of FIELDS) {
      if (typeof p[f] !== 'string') continue;
      const fixed = dropRepeatedWords(p[f]);
      if (fixed !== p[f]) patch[f] = fixed;
    }
    if (Object.keys(patch).length) todo.push({ id: p.id, patch });
  }
  let fixed = 0;
  for (let i = 0; i < todo.length; i += 10) {
    if (Date.now() - started > budgetMs) {
      console.log(`[listings] removed repeated words from ${fixed} listings; ${todo.length - fixed} left for the next start`);
      return fixed;
    }
    const batch = todo.slice(i, i + 10);
    await Promise.all(batch.map(({ id, patch }) => store.update('Provider', id, patch)));
    fixed += batch.length;
  }
  await store.create('Setting', { key: KEY, value: String(fixed) });
  if (fixed) console.log(`[listings] removed repeated words from ${fixed} listings`);
  return fixed;
}

// Two listing names that came in garbled (approved by Eli, 2026-10-23). The
// name is also written into each one's About text, so it is replaced there
// too, but not in the source link at the end of the Austin one. A name that
// has been changed since is left alone.
const NAMES_KEY = 'listing_garbled_names_fixed_2026_10_23';
export const NAME_FIXES = [
  // GoDaven, Spring Valley: the Premishlan minyan, its name typed twice.
  { id: '73cc2121621640708965b770', from: 'Prmeshlan Prmeshlan', to: 'Premishlan Minyan' },
  // Mikvah.org, Austin: the Chabad Austin women's mikvah.
  { id: 'a44e604de30c4c37a7229ca4', from: 'Mikva Tahara Austin Womens Mikvah Mikvah Rela', to: 'Mikvah Tahara Austin' },
];

export async function fixGarbledNames() {
  if ((await store.filter('Setting', { key: NAMES_KEY })).length) return 0;
  let fixed = 0;
  for (const { id, from, to } of NAME_FIXES) {
    const p = await store.get('Provider', id).catch(() => null);
    if (!p || p.name !== from) continue;
    const description = typeof p.description === 'string'
      ? p.description.split('\n').map((line) => (/^(Source|Google Maps):/.test(line) ? line : line.split(from).join(to))).join('\n')
      : p.description;
    await store.update('Provider', id, { name: to, description });
    fixed += 1;
  }
  await store.create('Setting', { key: NAMES_KEY, value: String(fixed) });
  if (fixed) console.log(`[listings] fixed ${fixed} garbled listing names`);
  return fixed;
}
