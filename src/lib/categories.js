// The categories the directory is built around.
//
// Shared because three places need the same list and had two of them: the
// seeder created them, the admin page let someone type them in one at a time,
// and nothing connected the two — so adding Shidduchim, Shuls & Minyanim and
// Other to this file did nothing for a directory already running, and putting
// them in by hand meant retyping the icon and the subcategories from memory.
//
// Adding one here is enough. The seeder picks it up on a fresh database, and
// Admin -> Categories offers it on a running one.
export const DIRECTORY_CATEGORIES = [
  { name: 'Home Services',   icon: 'Home',            order: 1,  subcategories: ['Plumbing', 'Electrical', 'Cleaning', 'Handyman'] },
  { name: 'Business',        icon: 'BriefcaseBusiness', order: 2, subcategories: ['Accounting', 'Marketing', 'Bookkeeping'] },
  { name: 'Health',          icon: 'HeartPulse',      order: 4,  subcategories: ['Pediatrics', 'Dentistry', 'Therapy'] },
  { name: 'Legal',           icon: 'Scale',           order: 5,  subcategories: ['Immigration', 'Real Estate', 'Family Law'] },
  { name: 'Technology',      icon: 'Laptop',          order: 6,  subcategories: ['IT Support', 'Web Development'] },
  { name: 'Education',       icon: 'GraduationCap',   order: 7,  subcategories: ['Tutoring', 'Test Prep', 'Special Ed'] },
  { name: 'Food & Catering', icon: 'Utensils',        order: 8,  subcategories: ['Catering', 'Bakery', 'Restaurants'] },
  // Not Shuls: they have their own category below, and offering both sent
  // half the shuls one way and half the other.
  { name: 'Community',       icon: 'Users',           order: 9,  subcategories: ['Schools', 'Youth'] },
  // Not Insurance: it has its own category below, for the same reason shuls do.
  { name: 'Financial',       icon: 'Landmark',        order: 10, subcategories: ['Mortgage', 'Tax'] },
  { name: 'Gemachim',        icon: 'Gift',            order: 11, subcategories: ['Medical Equipment', 'Simcha', 'Baby'] },
  { name: 'Simcha Services', icon: 'ShieldCheck',     order: 12, subcategories: ['Photography', 'Music', 'Flowers'] },
  // Resources and contacts only — shadchanim and the shidduch organisations
  // people already use. Deliberately not profiles or matching: who is dating is
  // nobody else's business, which is also why @/lib/sensitivity treats anything
  // in here as private (no public "used this", no named vouches).
  { name: 'Shidduchim',      icon: 'HandHeart',       order: 13, subcategories: ['Shadchanim', 'Shidduch organizations', 'Dating coaches'] },
  // Shuls are one of the six things the homepage offers to search for, and had
  // no category of their own — only a subcategory of Community, which the
  // listing form never offers.
  { name: 'Shuls & Minyanim', icon: 'TorahScroll',    order: 3,  subcategories: ['Shuls', 'Minyanim', 'Botei Medrash'] },
  // Its own card on Resources (Eli asked, 2026-10-19). It was a subcategory of
  // Financial, where nobody browsing for an agent would look.
  { name: 'Insurance',       icon: 'Umbrella',        order: 14, subcategories: ['Health Insurance', 'Life Insurance', 'Home & Auto', 'Business Insurance'] },
  // Last on purpose, and the reason it exists: category is required on the
  // listing form, so anything the list does not name could not be listed at
  // all. A directory should never refuse a resource for want of a heading. The
  // subcategory field is where it says what it actually is.
  { name: 'Other',           icon: 'MoreHorizontal', order: 99, subcategories: [] },
];

// What a category or subcategory is called on screen.
//
// Shuls get filed under whatever word the person adding them reached for —
// "Synagogue", "Shul", "Shuls" — and each read as a different kind of place.
// They are one thing, so they are shown as one name, and the name carries both
// words so a search for either finds it. Only the label changes: what is
// stored stays as typed, so filters and the listing form keep matching.
// "Shuls & Minyanim" too: it is the category's stored name, and the Resources
// grid should call it what people call it.
const SHUL_WORDS = /^(shul|shuls|synagogue|synagogues|shul\s*\/\s*synagogue|shuls\s*&\s*minyanim)$/i;
export const SHUL_LABEL = 'Shul/Synagogue';

export function categoryLabel(name) {
  const text = String(name ?? '').trim();
  return SHUL_WORDS.test(text) ? SHUL_LABEL : name;
}

// The "Category · Subcategory" line on a card or listing page. Every shul is
// filed as "Shuls & Minyanim" / "Shuls", and both read as Shul/Synagogue, so
// the line said the same thing twice. A subcategory is shown only when it adds
// something; with none, or one that reads the same, the category stands alone.
export function categoryLine(provider) {
  const main = categoryLabel(provider?.category);
  const sub = categoryLabel(provider?.subcategory);
  const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
  return [main, sub && !same(sub, main) ? sub : ''].filter((s) => String(s ?? '').trim()).join(' · ');
}

// Whether a listing's short description already says its tagline. Imported
// listings often carry the same sentence in both, or a description that is the
// tagline plus "From GoDaven's worldwide minyan database." A card that prints
// the grey subtitle and then the same words again underneath reads as machine
// output, so when this is true the subtitle is left out and the description
// says it once. Case, spacing and a trailing full stop do not count as a
// difference, and the match has to end on a whole word.
export function taglineRepeated(provider) {
  const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
  const tag = norm(provider?.tagline);
  const body = norm(provider?.short_description);
  return !!tag && body.startsWith(tag) && !/[\p{L}\p{N}]/u.test(body.charAt(tag.length));
}
