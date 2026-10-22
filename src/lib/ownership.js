// Jewish owned or not. Jewish owned is the default and shows nothing; only a
// listing marked Not Jewish owned carries a pill. Wherever listings are
// ranked, Jewish-owned ones come first within the same sort.

export const isNotJewishOwned = (p) => p?.not_jewish_owned === true;

// For a sort comparator: Jewish owned (0) before Not Jewish owned (1).
export const ownershipRank = (a, b) => (isNotJewishOwned(a) ? 1 : 0) - (isNotJewishOwned(b) ? 1 : 0);

// Same order otherwise, Jewish-owned first. Array sort is stable.
export const jewishOwnedFirst = (rows) => [...rows].sort(ownershipRank);

// The Resources filter. '' is All.
export const OWNERSHIP_FILTERS = [
  { id: '', label: 'All' },
  { id: 'jewish', label: 'Jewish-owned only' },
  { id: 'not_jewish', label: 'Not Jewish-owned only' },
];

export function ownershipMatches(p, filter) {
  if (filter === 'jewish') return !isNotJewishOwned(p);
  if (filter === 'not_jewish') return isNotJewishOwned(p);
  return true;
}

// Remembered per visitor, in this browser.
const KEY = 'kc-ownership-filter';
export function readOwnershipFilter() {
  try {
    const v = localStorage.getItem(KEY) || '';
    return OWNERSHIP_FILTERS.some((f) => f.id === v) ? v : '';
  } catch { return ''; }
}
export function saveOwnershipFilter(v) {
  try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* private mode */ }
}
