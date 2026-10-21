// What kind of kitchen a food place runs: meat, dairy, fish, pareve, or both
// meat and dairy in separate kitchens. One pick per listing, set on the
// listing form and shown as a pill on the listing page.
//
// It is the listing's own word (or what a hechsher's public list says), not
// something Klal has checked, so the pill never reads as a confirmation.
//
// `pill` follows the familiar colours: red for meat, blue for dairy.
export const KITCHENS = [
  { id: 'meat', label: 'Meat', hint: 'Fleishig', pill: 'bg-red-50 text-red-800 ring-1 ring-red-200 dark:bg-red-400/10 dark:text-red-300 dark:ring-red-400/30' },
  { id: 'dairy', label: 'Dairy', hint: 'Milchig', pill: 'bg-sky-50 text-sky-800 ring-1 ring-sky-200 dark:bg-sky-400/10 dark:text-sky-300 dark:ring-sky-400/30' },
  { id: 'fish', label: 'Fish', hint: 'No meat', pill: 'bg-teal-50 text-teal-800 ring-1 ring-teal-200 dark:bg-teal-400/10 dark:text-teal-300 dark:ring-teal-400/30' },
  { id: 'pareve', label: 'Pareve', hint: 'No meat or dairy', pill: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/30' },
  { id: 'meat_dairy', label: 'Meat & dairy', hint: 'Separate kitchens', pill: 'bg-violet-50 text-violet-800 ring-1 ring-violet-200 dark:bg-violet-400/10 dark:text-violet-300 dark:ring-violet-400/30' },
];

export const KITCHEN_BY_ID = Object.fromEntries(KITCHENS.map((k) => [k.id, k]));

// Restaurants, caterers, bakeries, pizza shops and the rest of the food
// category. A plumber has no kitchen to declare.
export const KITCHEN_CATEGORIES = ['Food & Catering'];

export const kitchenAppliesTo = (category) => KITCHEN_CATEGORIES.includes(category);

// The kitchen to store: a known id in a food category, or '' for anything
// else, so a category change away from food takes the label down with it.
export function normalizeKitchen(value, category) {
  return typeof value === 'string' && Object.hasOwn(KITCHEN_BY_ID, value) && kitchenAppliesTo(category) ? value : '';
}

export function kitchenOf(provider) {
  const id = normalizeKitchen(provider?.kitchen, provider?.category);
  return id ? KITCHEN_BY_ID[id] : null;
}

// The Meat / Dairy filter. A place with both kitchens is a meat place and a
// dairy place, so it answers to either.
export function kitchenMatches(provider, wanted) {
  if (!wanted) return true;
  const id = kitchenOf(provider)?.id;
  return id === wanted || (id === 'meat_dairy' && (wanted === 'meat' || wanted === 'dairy'));
}
