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
  { name: 'Health',          icon: 'HeartPulse',      order: 3,  subcategories: ['Pediatrics', 'Dentistry', 'Therapy'] },
  { name: 'Legal',           icon: 'Scale',           order: 4,  subcategories: ['Immigration', 'Real Estate', 'Family Law'] },
  { name: 'Technology',      icon: 'Laptop',          order: 5,  subcategories: ['IT Support', 'Web Development'] },
  { name: 'Education',       icon: 'GraduationCap',   order: 6,  subcategories: ['Tutoring', 'Test Prep', 'Special Ed'] },
  { name: 'Food & Catering', icon: 'Utensils',        order: 7,  subcategories: ['Catering', 'Bakery', 'Restaurants'] },
  // Not Shuls: they have their own category below, and offering both sent
  // half the shuls one way and half the other.
  { name: 'Community',       icon: 'Users',           order: 8,  subcategories: ['Schools', 'Youth'] },
  // Not Insurance: it has its own category below, for the same reason shuls do.
  { name: 'Financial',       icon: 'Landmark',        order: 9,  subcategories: ['Mortgage', 'Tax'] },
  { name: 'Gemachim',        icon: 'Gift',            order: 10, subcategories: ['Medical Equipment', 'Simcha', 'Baby'] },
  { name: 'Simcha Services', icon: 'ShieldCheck',     order: 11, subcategories: ['Photography', 'Music', 'Flowers'] },
  // Resources and contacts only — shadchanim and the shidduch organisations
  // people already use. Deliberately not profiles or matching: who is dating is
  // nobody else's business, which is also why @/lib/sensitivity treats anything
  // in here as private (no public "used this", no named vouches).
  { name: 'Shidduchim',      icon: 'HandHeart',       order: 12, subcategories: ['Shadchanim', 'Shidduch organizations', 'Dating coaches'] },
  // Shuls are one of the six things the homepage offers to search for, and had
  // no category of their own — only a subcategory of Community, which the
  // listing form never offers.
  { name: 'Shuls & Minyanim', icon: 'TorahScroll',    order: 13, subcategories: ['Shuls', 'Minyanim', 'Botei Medrash'] },
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
